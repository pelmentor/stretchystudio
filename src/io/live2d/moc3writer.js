/**
 * Minimal .moc3 binary writer for Live2D Cubism export.
 *
 * Generates a valid .moc3 binary file from Stretchy Studio project data.
 * The binary layout follows the format documented by py-moc3 and moc3ingbird:
 *
 *   [0..64)      Header: "MOC3" magic + version + endian flag + padding
 *   [64..704)    Section Offset Table (SOT): 160 x uint32 (640 bytes)
 *   [704..832)   Count Info Table: 23 x uint32 + padding (128 bytes)
 *   [832..1984)  Reserved / padding
 *   [1984..)     Body: count info, canvas info, then typed-array sections
 *
 * Each body section is 64-byte aligned. The SOT stores absolute offsets
 * from file start. Byte order is little-endian.
 *
 * Reference: py-moc3 _core.py (Ludentes/py-moc3) — verified read+write
 *
 * Parameter list comes from `rig/paramSpec.js` — same source of truth
 * cmo3writer uses, so the runtime moc3 ships with the SDK-standard rig
 * (ParamAngleX/Y/Z, EyeLOpen/ROpen, ParamMouthOpenY, variant params, …).
 * NOTE: deformer + keyform parity with cmo3writer is still future work
 * (Stage 2). Without warp/rotation deformers, the params exist but only
 * ParamOpacity actually deforms anything in the runtime model.
 *
 * @module io/live2d/moc3writer
 */
import { buildParameterSpec } from './rig/paramSpec.js';
import { variantParamId } from '../psdOrganizer.js';
import { matchTag } from '../armatureOrganizer.js';

// Clip mask rules — mirrors `CLIP_RULES` in cmo3writer. iris meshes get
// occluded by the corresponding eyewhite (variant-aware: variant iris
// masked by variant eyewhite).
const CLIP_RULES = {
  'irides':    'eyewhite',
  'irides-l':  'eyewhite-l',
  'irides-r':  'eyewhite-r',
};

// Source: [ref][py-moc3] — format constants from reference file + py-moc3
const MAGIC = [0x4D, 0x4F, 0x43, 0x33]; // "MOC3"
const HEADER_SIZE = 64;
const SOT_COUNT = 160;
const SOT_SIZE = SOT_COUNT * 4; // 640 bytes
const COUNT_INFO_ENTRIES = 23;
const COUNT_INFO_SIZE = 128; // 23 * 4 = 92, padded to 128
const CANVAS_INFO_SIZE = 64;
const DEFAULT_OFFSET = 1984; // body starts here
const ALIGN = 64;
const RUNTIME_UNIT_SIZE = 8;
const STRING_FIELD_SIZE = 64; // MOC3Id is a 64-byte null-padded UTF-8 string

// Source: [py-moc3] — version enum
const MOC_VERSION = {
  V3_00: 1,
  V3_03: 2,
  V4_00: 3,
  V4_02: 4,
  V5_00: 5,
};

// Source: [py-moc3] — count info indices
const COUNT_IDX = {
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
const ELEM = {
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
const SECTION_LAYOUT = [
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


// ---------------------------------------------------------------------------
// Binary writer helper
// ---------------------------------------------------------------------------

class BinaryWriter {
  constructor() {
    /** @type {number[]} */
    this._buf = [];
  }

  get pos() { return this._buf.length; }

  writeU8(v)  { this._buf.push(v & 0xFF); }
  writeI16(v) { const b = new ArrayBuffer(2); new DataView(b).setInt16(0, v, true); this._pushBytes(b); }
  writeI32(v) { const b = new ArrayBuffer(4); new DataView(b).setInt32(0, v, true); this._pushBytes(b); }
  writeU32(v) { const b = new ArrayBuffer(4); new DataView(b).setUint32(0, v, true); this._pushBytes(b); }
  writeF32(v) { const b = new ArrayBuffer(4); new DataView(b).setFloat32(0, v, true); this._pushBytes(b); }

  writeI32Array(vals)  { for (const v of vals) this.writeI32(v); }
  writeU32Array(vals)  { for (const v of vals) this.writeU32(v); }
  writeF32Array(vals)  { for (const v of vals) this.writeF32(v); }
  writeI16Array(vals)  { for (const v of vals) this.writeI16(v); }
  writeU8Array(vals)   { for (const v of vals) this.writeU8(v); }
  writeBoolArray(vals) { for (const v of vals) this.writeI32(v ? 1 : 0); }

  writeString(s, fieldSize = STRING_FIELD_SIZE) {
    const encoder = new TextEncoder();
    const encoded = encoder.encode(s);
    if (encoded.length >= fieldSize) {
      throw new Error(`String "${s}" too long for ${fieldSize}-byte field`);
    }
    for (const byte of encoded) this._buf.push(byte);
    // Null-pad to fieldSize
    for (let i = encoded.length; i < fieldSize; i++) this._buf.push(0);
  }

  writeStringArray(vals) { for (const s of vals) this.writeString(s); }

  writeRuntime(count) {
    // Runtime space: zeroed bytes
    this.fill(count * RUNTIME_UNIT_SIZE);
  }

  fill(count, value = 0) {
    for (let i = 0; i < count; i++) this._buf.push(value);
  }

  padTo(alignment) {
    const rem = this._buf.length % alignment;
    if (rem !== 0) this.fill(alignment - rem);
  }

  /** Patch a uint32 value at a previously known position. */
  patchU32(offset, value) {
    const b = new ArrayBuffer(4);
    new DataView(b).setUint32(0, value, true);
    const bytes = new Uint8Array(b);
    for (let i = 0; i < 4; i++) this._buf[offset + i] = bytes[i];
  }

  toArrayBuffer() {
    return new Uint8Array(this._buf).buffer;
  }

  _pushBytes(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    for (const b of bytes) this._buf.push(b);
  }
}


// ---------------------------------------------------------------------------
// Data preparation — convert project data to moc3 section arrays
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Moc3Input
 * @property {object}  project      - projectStore.project snapshot
 * @property {Map<string, import('./textureAtlas.js').PackedRegion>} regions - Atlas regions
 * @property {number}  atlasSize    - Atlas dimension
 * @property {number}  numAtlases   - Number of texture atlas sheets
 * @property {boolean} [generateRig=true] - Emit the 22 SDK-standard parameters
 *   (ParamAngleX/Y/Z, EyeBlink, MouthOpen, …). Defaults to true for runtime
 *   exports — face-tracking apps and motion presets need them.
 * @property {import('./rig/rigSpec.js').RigSpec} [rigSpec=null]
 *   Shared rig data (warp + rotation deformers, art-mesh keyforms, parts).
 *   When provided, the writer emits the full deformer infrastructure;
 *   without it, the moc3 ships without deformers (legacy mesh-only mode).
 */

/**
 * Build all section data arrays from project data.
 *
 * @param {Moc3Input} input
 * @returns {{ sections: Map<string, any[]>, counts: number[], canvas: object }}
 */
function buildSectionData(input) {
  const { project, regions, atlasSize, numAtlases, generateRig = true, rigSpec = null } = input;

  const canvasW = project.canvas?.width ?? 800;
  const canvasH = project.canvas?.height ?? 600;

  const sections = new Map();
  const counts = new Array(COUNT_INFO_ENTRIES).fill(0);

  // Collect parts (groups → Live2D Parts)
  const groups = project.nodes.filter(n => n.type === 'group');
  // Always have at least one root part
  const partNodes = groups.length > 0 ? groups : [{ id: 'PartRoot', name: 'Root', parent: null, opacity: 1, visible: true }];

  // Collect art meshes (parts with meshes → Live2D ArtMeshes).
  // Sort by draw_order (descending) to maintain correct depth ordering (upstream fix).
  const meshParts = project.nodes
    .filter(n =>
      n.type === 'part' && n.mesh && n.visible !== false && regions.has(n.id)
    )
    .sort((a, b) => (b.draw_order ?? 0) - (a.draw_order ?? 0));

  // Build parameter list via the shared spec (same source of truth cmo3writer
  // uses). Used to live as `project.parameters ?? []` here, which evaluated
  // to empty for fresh PSD imports — leaving the runtime moc3 with only
  // ParamOpacity and breaking cursor tracking / blink / variant fades.
  //
  // paramSpec expects mesh-shaped objects with bone/variant fields hoisted
  // to the top level (matching cmo3writer's pre-mapped meshes). Raw project
  // nodes nest those under `node.mesh.*`, so we adapt here before the call.
  const meshesForSpec = meshParts.map(n => ({
    variantSuffix: n.variantSuffix ?? null,
    variantRole: n.variantRole ?? null,
    jointBoneId: n.mesh?.jointBoneId ?? null,
    boneWeights: n.mesh?.boneWeights ?? null,
  }));
  const params = buildParameterSpec({
    baseParameters: project.parameters ?? [],
    meshes: meshesForSpec,
    groups,
    generateRig,
  });

  // Build Part ID → index map
  const partIdMap = new Map();
  partNodes.forEach((p, i) => partIdMap.set(p.id, i));

  // --- Counts ---
  const numParts = partNodes.length;
  const numArtMeshes = meshParts.length;
  // buildParameterSpec always returns at least ParamOpacity (no empty list).
  const numParams = params.length;
  // ART_MESH_KEYFORMS count is set later from `totalArtMeshKeyforms` once the
  // per-mesh plan is built (variant meshes have 2 keyforms, others 1).
  const numPartKeyforms = numParts;

  // Compute UV and vertex counts
  //
  // IMPORTANT: Field names in .moc3 are COUNTERINTUITIVE (confirmed via Hiyori RE):
  //   art_mesh.vertex_counts       = FLAT TRIANGLE INDEX COUNT (mesh.triangles.length * 3)
  //   art_mesh.position_index_counts = RENDERING VERTEX COUNT (mesh.vertices.length)
  //   art_mesh.uv_begin_indices    = cumulative(position_index_counts * 2)
  //   art_mesh.position_index_begin_indices = cumulative(vertex_counts)
  //   counts[15] (UVS)             = sum(position_index_counts * 2)
  //   counts[16] (POSITION_INDICES) = sum(vertex_counts) = total flat indices
  //
  // In Hiyori: sum(vertex_counts) == counts[16] (POSITION_INDICES),
  //            uv_begin = cumul(position_index_counts * 2).
  // csmGetDrawableVertexCounts returns position_index_counts values.

  let totalUVs = 0;
  let totalFlatIndices = 0;
  let totalKeyformPositions = 0;

  const meshInfos = meshParts.map(part => {
    const mesh = part.mesh;
    // vertices is Array<{x, y}> — the rendering vertex count
    const renderVertCount = mesh.vertices ? mesh.vertices.length : 0;
    // triangles is Array<[i, j, k]> — flat index count = triangles * 3
    const flatIndexCount = mesh.triangles ? mesh.triangles.length * 3 : 0;

    const info = {
      renderVertCount,                          // → position_index_counts
      flatIndexCount,                           // → vertex_counts
      uvBeginIndex: totalUVs,                   // cumul(renderVertCount * 2)
      positionIndexBeginIndex: totalFlatIndices, // cumul(flatIndexCount)
      keyformPositionBeginIndex: totalKeyformPositions,
    };

    totalUVs += renderVertCount * 2;
    totalFlatIndices += flatIndexCount;
    totalKeyformPositions += renderVertCount * 2;

    return info;
  });

  counts[COUNT_IDX.PARTS] = numParts;
  counts[COUNT_IDX.ART_MESHES] = numArtMeshes;
  counts[COUNT_IDX.PARAMETERS] = numParams;
  counts[COUNT_IDX.PART_KEYFORMS] = numPartKeyforms;
  counts[COUNT_IDX.KEYFORM_POSITIONS] = totalKeyformPositions;
  counts[COUNT_IDX.UVS] = totalUVs;
  counts[COUNT_IDX.POSITION_INDICES] = totalFlatIndices;

  // --- Per-mesh keyform/binding plan ---
  // Three mutually-exclusive cases:
  //   • Bone-weighted mesh (arms / legs / hands): 5 keyforms across
  //     ParamRotation_<bone> at angles [-90, -45, 0, +45, +90] degrees.
  //     Each keyform's vertex positions = rest rotated around the bone's
  //     canvas pivot, weighted by boneWeights[i] per vertex. Mirrors
  //     cmo3's baked-bone-keyform logic so arms actually rotate with the
  //     bone in the runtime.
  //   • Variant mesh (`foo.smile`): 2 keyforms on Param<Suffix> (opacity
  //     0 at 0, recorded opacity at 1). Stage 2a fix.
  //   • Other mesh: 1 keyform on ParamOpacity (rest pose at recorded
  //     opacity).
  // perVertexPositions (when present) drives art_mesh_keyform.keyform_position
  // emission instead of the shared rest geometry, allowing arm rotation to
  // deform meshes via per-keyform vertex offsets.
  const BONE_KEYFORM_ANGLES = [-90, -45, 0, 45, 90]; // matches paramSpec BAKED_BONE_ANGLES
  const meshBindingPlan = meshParts.map(part => {
    const mesh = part.mesh;
    const boneWeights = mesh?.boneWeights ?? null;
    const jointBoneId = mesh?.jointBoneId ?? null;
    if (boneWeights && jointBoneId) {
      // Bone-baked keyforms.
      const boneGroup = groups.find(g => g.id === jointBoneId);
      const sanitizedBoneName = (boneGroup?.name ?? jointBoneId).replace(/[^a-zA-Z0-9_]/g, '_');
      const pivotX = boneGroup?.transform?.pivotX ?? 0;
      const pivotY = boneGroup?.transform?.pivotY ?? 0;
      const verts = mesh.vertices;
      const perKeyformPositions = BONE_KEYFORM_ANGLES.map(angleDeg => {
        const rad = angleDeg * Math.PI / 180;
        const cos = Math.cos(rad), sin = Math.sin(rad);
        const out = new Float32Array(verts.length * 2);
        for (let i = 0; i < verts.length; i++) {
          const v = verts[i];
          const w = boneWeights[i] ?? 0;
          // Rotate (vx - pivotX, vy - pivotY) by angle, weighted blend
          // back into rest position. Matches cmo3 baked-keyform math.
          const dx = v.x - pivotX;
          const dy = v.y - pivotY;
          const rx = pivotX + dx * cos - dy * sin;
          const ry = pivotY + dx * sin + dy * cos;
          out[i * 2]     = v.x * (1 - w) + rx * w;
          out[i * 2 + 1] = v.y * (1 - w) + ry * w;
        }
        return out;
      });
      return {
        paramId: `ParamRotation_${sanitizedBoneName}`,
        keys: BONE_KEYFORM_ANGLES.slice(),
        keyformOpacities: BONE_KEYFORM_ANGLES.map(() => part.opacity ?? 1),
        perVertexPositions: perKeyformPositions,
      };
    }
    const suffix = part.variantSuffix ?? null;
    if (suffix) {
      const pid = variantParamId(suffix);
      if (pid) {
        return {
          paramId: pid,
          keys: [0, 1],
          keyformOpacities: [0, part.opacity ?? 1],
          perVertexPositions: null,
        };
      }
    }
    return {
      paramId: 'ParamOpacity',
      keys: [1],
      keyformOpacities: [part.opacity ?? 1],
      perVertexPositions: null,
    };
  });

  // Flatten per-mesh keyform offsets (used by art_mesh.keyform_begin_indices /
  // _counts). The per-binding key range is computed later in the unified
  // keyform binding system, where mesh + deformer bindings live in one list.
  let totalArtMeshKeyforms = 0;
  const meshKeyformBeginIndex = [];
  const meshKeyformCount = [];
  for (const plan of meshBindingPlan) {
    meshKeyformBeginIndex.push(totalArtMeshKeyforms);
    meshKeyformCount.push(plan.keyformOpacities.length);
    totalArtMeshKeyforms += plan.keyformOpacities.length;
  }

  counts[COUNT_IDX.ART_MESH_KEYFORMS] = totalArtMeshKeyforms;

  // ── Deformer rig (Stage 2b) — warp + rotation deformers from rigSpec ──
  // Both writers share buildBodyWarpChain / buildFaceRotationSpec / etc. to
  // produce the rigSpec; this writer translates the spec into the moc3
  // deformer / warp_deformer / rotation_deformer / *_keyform / keyform_position
  // sections. Without rigSpec the moc3 ships without deformers (legacy mode).
  const warpSpecs = rigSpec ? rigSpec.warpDeformers : [];
  const rotationSpecs = rigSpec ? rigSpec.rotationDeformers : [];
  const numWarpDeformers = warpSpecs.length;
  const numRotationDeformers = rotationSpecs.length;
  const numDeformers = numWarpDeformers + numRotationDeformers;
  // Unified deformer order: warps first, rotations after. Index in this array
  // = the deformer's index in the moc3 DEFORMERS section (and in the
  // parent_deformer_indices references).
  const allDeformerSpecs = [...warpSpecs, ...rotationSpecs];
  const deformerIdToIndex = new Map();
  for (let di = 0; di < allDeformerSpecs.length; di++) {
    deformerIdToIndex.set(allDeformerSpecs[di].id, di);
  }
  // The deepest body warp — meshes parent to it when no per-mesh deformer
  // (face parallax / rig warp) supersedes. Falls back through the chain.
  const meshDefaultDeformerIdx = (
    deformerIdToIndex.get('BodyXWarp') ??
    deformerIdToIndex.get('BreathWarp') ??
    deformerIdToIndex.get('BodyWarpY') ??
    deformerIdToIndex.get('BodyWarpZ') ??
    -1
  );

  counts[COUNT_IDX.DEFORMERS] = numDeformers;
  counts[COUNT_IDX.WARP_DEFORMERS] = numWarpDeformers;
  counts[COUNT_IDX.ROTATION_DEFORMERS] = numRotationDeformers;

  // Drawable masks: 1 dummy entry (SDK requires begin < total, can't use -1 with total=0)
  // DRAWABLE_MASKS count + section emit moved below — depends on
  // drawableMaskIndices populated during the iris→eyewhite scan.
  // (Kept as 1 here so any earlier validation that runs before that block
  // still sees a non-zero count; overwritten below.)
  counts[COUNT_IDX.DRAWABLE_MASKS] = 1;

  // Draw order groups: 1 root group
  counts[COUNT_IDX.DRAW_ORDER_GROUPS] = 1;
  counts[COUNT_IDX.DRAW_ORDER_GROUP_OBJECTS] = numArtMeshes;

  // --- Part sections ---
  sections.set('part.ids', partNodes.map(p => p.id));
  // Parts use null bands (count=0) at indices after the mesh bands
  sections.set('part.keyform_binding_band_indices', partNodes.map((_, j) => numArtMeshes + j));
  sections.set('part.keyform_begin_indices', partNodes.map((_, i) => i));
  sections.set('part.keyform_counts', partNodes.map(() => 1));
  sections.set('part.visibles', partNodes.map(p => p.visible !== false));
  sections.set('part.enables', partNodes.map(() => true));
  sections.set('part.parent_part_indices', partNodes.map(p => {
    if (p.parent && partIdMap.has(p.parent)) return partIdMap.get(p.parent);
    return -1;
  }));

  // --- ArtMesh sections ---
  sections.set('art_mesh.ids', meshParts.map((p, i) => `ArtMesh${i}`));
  // Each mesh gets its own binding band (band i → mesh i)
  sections.set('art_mesh.keyform_binding_band_indices', meshParts.map((_, i) => i));
  // Variable-length keyform layout — see meshBindingPlan above. Variant meshes
  // get 2 keyforms (opacity 0/1 across Param<Suffix>); others stay at 1.
  sections.set('art_mesh.keyform_begin_indices', meshKeyformBeginIndex);
  sections.set('art_mesh.keyform_counts', meshKeyformCount);
  sections.set('art_mesh.visibles', meshParts.map(p => p.visible !== false));
  sections.set('art_mesh.enables', meshParts.map(() => true));
  sections.set('art_mesh.parent_part_indices', meshParts.map(p => {
    if (p.parent && partIdMap.has(p.parent)) return partIdMap.get(p.parent);
    return 0; // default to first part
  }));
  sections.set('art_mesh.parent_deformer_indices', meshParts.map(() => -1)); // no deformers for MVP
  sections.set('art_mesh.texture_indices', meshParts.map(p => regions.get(p.id)?.atlasIndex ?? 0));
  sections.set('art_mesh.drawable_flags', meshParts.map(() => 4)); // flag 4 like Hiyori
  // COUNTERINTUITIVE: position_index_counts = render vertex count, vertex_counts = flat index count
  sections.set('art_mesh.position_index_counts', meshInfos.map(m => m.renderVertCount));
  sections.set('art_mesh.uv_begin_indices', meshInfos.map(m => m.uvBeginIndex));
  sections.set('art_mesh.position_index_begin_indices', meshInfos.map(m => m.positionIndexBeginIndex));
  sections.set('art_mesh.vertex_counts', meshInfos.map(m => m.flatIndexCount));
  // ── Clip masks (drawable_mask) ──
  // CLIP_RULES says iris meshes are masked by their corresponding eyewhite.
  // Variant-aware: variant iris masked by variant eyewhite (same suffix);
  // base iris masked by base eyewhite. Without this the iris extends past
  // the eyewhite at extreme cursor positions.
  const basePidByTag = new Map();
  const variantPidByTagAndSuffix = new Map();
  for (let mi = 0; mi < meshParts.length; mi++) {
    const part = meshParts[mi];
    const tag = matchTag(part.name || part.id);
    if (!tag) continue;
    const sfx = part.variantSuffix ?? null;
    if (sfx) {
      const key = `${tag}|${sfx}`;
      if (!variantPidByTagAndSuffix.has(key)) variantPidByTagAndSuffix.set(key, mi);
    } else if (!basePidByTag.has(tag)) {
      basePidByTag.set(tag, mi);
    }
  }
  const drawableMaskIndices = [];
  const meshMaskBegin = new Array(meshParts.length).fill(0);
  const meshMaskCount = new Array(meshParts.length).fill(0);
  for (let mi = 0; mi < meshParts.length; mi++) {
    const part = meshParts[mi];
    const tag = matchTag(part.name || part.id);
    if (!tag) continue;
    const maskTag = CLIP_RULES[tag];
    if (!maskTag) continue;
    const sfx = part.variantSuffix ?? null;
    let maskIdx = sfx ? variantPidByTagAndSuffix.get(`${maskTag}|${sfx}`) : null;
    if (maskIdx == null) maskIdx = basePidByTag.get(maskTag);
    if (maskIdx == null) continue;
    meshMaskBegin[mi] = drawableMaskIndices.length;
    meshMaskCount[mi] = 1;
    drawableMaskIndices.push(maskIdx);
  }
  sections.set('art_mesh.mask_begin_indices', meshMaskBegin);
  sections.set('art_mesh.mask_counts', meshMaskCount);

  // --- Parameter sections ---
  // `params` came from buildParameterSpec — fields are {id, name, min, max,
  // default, decimalPlaces, repeat, role, …}.
  const paramList = params;

  sections.set('parameter.ids', paramList.map(p => p.id));
  sections.set('parameter.max_values', paramList.map(p => p.max));
  sections.set('parameter.min_values', paramList.map(p => p.min));
  sections.set('parameter.default_values', paramList.map(p => p.default));
  sections.set('parameter.repeats', paramList.map(p => p.repeat ?? false));
  sections.set('parameter.decimal_places', paramList.map(p => p.decimalPlaces ?? 1));

  // ── Unified keyform binding system (meshes + deformers) ──
  // Each "binding" maps a parameter axis to a list of key values. The owner
  // (mesh / deformer) declares one binding per axis; together the owner's
  // bindings define the cross-product of keyform cells. ParamOpacity owns
  // non-variant mesh bindings; Param<Suffix> owns variant mesh bindings;
  // ParamBodyAngleX/Y/Z + ParamBreath own the body-warp deformer bindings;
  // ParamAngleZ owns face rotation; etc.
  /** @type {{paramId:string, keys:number[], ownerKind:string, ownerIdx:number, axisIdx:number}[]} */
  const allBindings = [];
  // Mesh bindings — same plan as before, just added to the unified list.
  for (let m = 0; m < meshBindingPlan.length; m++) {
    const plan = meshBindingPlan[m];
    allBindings.push({
      paramId: plan.paramId, keys: plan.keys,
      ownerKind: 'mesh', ownerIdx: m, axisIdx: 0,
    });
  }
  // Deformer bindings — one per axis per deformer (typical: 1 axis).
  /** @type {{begin:number, count:number}[]} */
  const deformerBindingRanges = [];
  for (let d = 0; d < allDeformerSpecs.length; d++) {
    const spec = allDeformerSpecs[d];
    const begin = allBindings.length;
    for (let a = 0; a < spec.bindings.length; a++) {
      const b = spec.bindings[a];
      allBindings.push({
        paramId: b.parameterId, keys: b.keys,
        ownerKind: d < numWarpDeformers ? 'warp' : 'rotation',
        ownerIdx: d < numWarpDeformers ? d : d - numWarpDeformers,
        axisIdx: a,
      });
    }
    deformerBindingRanges.push({ begin, count: spec.bindings.length });
  }

  // Per-binding key range — flat keys array, one entry per param value.
  const bindingKeysBegin = [];
  const bindingKeysCount = [];
  const flatKeys = [];
  for (const b of allBindings) {
    bindingKeysBegin.push(flatKeys.length);
    bindingKeysCount.push(b.keys.length);
    for (const k of b.keys) flatKeys.push(k);
  }

  // Each parameter owns a contiguous range of slots in keyform_binding_index.
  // Build that ordered slot list by walking paramList and emitting each param's
  // bindings in order. Recorded `bindingToSlot[bi]` lets bands look up the
  // slot offset for any binding when assigning their begin index.
  const slotsByParam = new Map();
  for (const p of paramList) slotsByParam.set(p.id, []);
  for (let bi = 0; bi < allBindings.length; bi++) {
    const pid = allBindings[bi].paramId;
    if (!slotsByParam.has(pid)) slotsByParam.set(pid, []);
    slotsByParam.get(pid).push(bi);
  }
  const keyformBindingIndices = [];
  const bindingToSlot = new Array(allBindings.length).fill(0);
  const paramKfbBegin = [];
  const paramKfbCount = [];
  for (const p of paramList) {
    const myBindings = slotsByParam.get(p.id) ?? [];
    paramKfbBegin.push(keyformBindingIndices.length);
    paramKfbCount.push(myBindings.length);
    for (const bi of myBindings) {
      bindingToSlot[bi] = keyformBindingIndices.length;
      keyformBindingIndices.push(bi);
    }
  }
  sections.set('parameter.keyform_binding_begin_indices', paramKfbBegin);
  sections.set('parameter.keyform_binding_counts', paramKfbCount);

  counts[COUNT_IDX.KEYFORM_BINDINGS] = allBindings.length;
  counts[COUNT_IDX.KEYFORM_BINDING_INDICES] = keyformBindingIndices.length;
  counts[COUNT_IDX.KEYS] = flatKeys.length;

  // --- Part Keyform sections ---
  // Draw orders: all 500.0 (Hiyori pattern — actual order via draw_order_group_object)
  sections.set('part_keyform.draw_orders', partNodes.map(() => 500.0));

  // --- ArtMesh Keyform sections ---
  // Flat across all keyforms — per-mesh keyform count is variable.
  //   - Variant fade / single-keyform: keyforms share the mesh's REST
  //     vertex data (one position_begin per mesh).
  //   - Bone-baked: each angle keyform has its OWN rotated vertex
  //     positions. The position_begin is patched after warp keyforms
  //     extend keyform_position section (see bone keyform pass below).
  const flatOpacities = [];
  const flatDrawOrders = [];
  const flatKeyformPosBegin = [];
  /** @type {{flatIndex:number, partIndex:number, positions:Float32Array}[]} */
  const bonePerKeyformAppends = [];
  for (let m = 0; m < meshBindingPlan.length; m++) {
    const plan = meshBindingPlan[m];
    const restPosBegin = meshInfos[m].keyformPositionBeginIndex;
    for (let ki = 0; ki < plan.keyformOpacities.length; ki++) {
      flatOpacities.push(plan.keyformOpacities[ki]);
      flatDrawOrders.push(500.0);
      if (plan.perVertexPositions && plan.perVertexPositions[ki]) {
        // Sentinel — patched after warp keyforms append their grid data.
        flatKeyformPosBegin.push(-1);
        bonePerKeyformAppends.push({
          flatIndex: flatKeyformPosBegin.length - 1,
          partIndex: m,
          positions: plan.perVertexPositions[ki],
        });
      } else {
        flatKeyformPosBegin.push(restPosBegin);
      }
    }
  }
  sections.set('art_mesh_keyform.opacities', flatOpacities);
  sections.set('art_mesh_keyform.draw_orders', flatDrawOrders);
  // keyform_position_begin_indices written after sentinels resolved.

  // --- Keyform positions (vertex coordinates) ---
  // Frame matches the mesh's PARENT deformer's local frame. Three cases:
  //   - No deformer parent (legacy):       canvas-px-normalised by PPU.
  //   - Per-mesh rig warp parent:          0..1 of the rig warp's canvas
  //                                        bbox (matches cmo3 mesh
  //                                        emission convention at line
  //                                        ~3497-3503).
  //   - Body warp chain (BodyXWarp) parent (no rig warp): BX 0..1 via
  //                                        the canvasToBodyXX/Y chain.
  // TRAPDOOR: canvasW/canvasH are declared at top of buildSectionData().
  // The `canvas` object is declared BELOW — never reference it here.
  // See docs/live2d-export/DECISIONS.md — this caused two identical crashes.
  const ppu = Math.max(canvasW, canvasH);
  const originX = canvasW / 2;
  const originY = canvasH / 2;
  const useDeformerFrame = !!(rigSpec && rigSpec.canvasToInnermostX && meshDefaultDeformerIdx >= 0);
  // Map partId → rig warp spec for per-mesh frame conversion.
  const rigWarpByPartId = new Map();
  if (rigSpec) {
    for (const w of warpSpecs) {
      if (w.targetPartId && w.canvasBbox) rigWarpByPartId.set(w.targetPartId, w);
    }
  }
  const allKeyformPositions = [];
  for (const part of meshParts) {
    if (!part.mesh?.vertices) continue;
    const rigWarp = rigWarpByPartId.get(part.id);
    for (const vert of part.mesh.vertices) {
      if (rigWarp) {
        // 0..1 of rig warp's canvas bbox (matches cmo3 deformer-local for
        // rig-warp-parented meshes — see cmo3writer line ~3497-3503).
        const bb = rigWarp.canvasBbox;
        allKeyformPositions.push((vert.x - bb.minX) / bb.W);
        allKeyformPositions.push((vert.y - bb.minY) / bb.H);
      } else if (useDeformerFrame) {
        allKeyformPositions.push(rigSpec.canvasToInnermostX(vert.x));
        allKeyformPositions.push(rigSpec.canvasToInnermostY(vert.y));
      } else {
        allKeyformPositions.push((vert.x - originX) / ppu);
        allKeyformPositions.push((vert.y - originY) / ppu);
      }
    }
  }
  sections.set('keyform_position.xys', allKeyformPositions);

  // ── Bands (one per mesh, one per part, one per deformer) ──
  // Mesh / deformer bands point to their first binding's slot in
  // keyform_binding_index. Part bands are null (count=0).
  const numBands = numArtMeshes + numParts + numDeformers;
  counts[COUNT_IDX.KEYFORM_BINDING_BANDS] = numBands;
  const bandBegins = [];
  const bandCounts = [];
  // Mesh bands: binding bi == mesh bi (first numArtMeshes entries in allBindings)
  for (let m = 0; m < numArtMeshes; m++) {
    bandBegins.push(bindingToSlot[m]);
    bandCounts.push(1);
  }
  // Part bands (null)
  for (let p = 0; p < numParts; p++) {
    bandBegins.push(0);
    bandCounts.push(0);
  }
  // Deformer bands — point to the first binding for each deformer
  for (let d = 0; d < allDeformerSpecs.length; d++) {
    const range = deformerBindingRanges[d];
    if (range.count === 0) {
      bandBegins.push(0);
      bandCounts.push(0);
    } else {
      bandBegins.push(bindingToSlot[range.begin]);
      bandCounts.push(range.count);
    }
  }
  sections.set('keyform_binding_band.begin_indices', bandBegins);
  sections.set('keyform_binding_band.counts', bandCounts);

  sections.set('keyform_binding_index.indices', keyformBindingIndices);
  sections.set('keyform_binding.keys_begin_indices', bindingKeysBegin);
  sections.set('keyform_binding.keys_counts', bindingKeysCount);
  sections.set('keys.values', flatKeys);

  // ──────────────────────────────────────────────────────────────────
  // Deformer sections (Stage 2b binary translator)
  // ──────────────────────────────────────────────────────────────────
  // Deformer band indices follow mesh + part bands.
  const deformerBandOffset = numArtMeshes + numParts;

  // ── Umbrella deformer section ──
  const deformer_ids = [];
  const deformer_band_indices = [];
  const deformer_visibles = [];
  const deformer_enables = [];
  const deformer_parent_part_indices = [];
  const deformer_parent_deformer_indices = [];
  const deformer_types = [];
  const deformer_specific_indices = [];
  let _warpIdx = 0;
  let _rotIdx = 0;
  for (let d = 0; d < allDeformerSpecs.length; d++) {
    const spec = allDeformerSpecs[d];
    deformer_ids.push(spec.id);
    deformer_band_indices.push(deformerBandOffset + d);
    deformer_visibles.push(spec.isVisible !== false);
    deformer_enables.push(true);
    let pp = -1, pd = -1;
    if (spec.parent.type === 'root' || spec.parent.type === 'part') {
      pp = 0; // root part is always index 0 in this writer's part section.
    } else if (spec.parent.type === 'warp' || spec.parent.type === 'rotation') {
      pd = deformerIdToIndex.get(spec.parent.id) ?? -1;
      // Fallback: when the named parent isn't in this rigSpec (e.g. rig-warp
      // points to FaceParallax but face parallax extraction is pending),
      // attach to the deepest body warp so the deformer isn't orphaned.
      if (pd < 0 && meshDefaultDeformerIdx >= 0) pd = meshDefaultDeformerIdx;
    }
    deformer_parent_part_indices.push(pp);
    deformer_parent_deformer_indices.push(pd);
    if (d < numWarpDeformers) {
      deformer_types.push(0); // 0 = warp
      deformer_specific_indices.push(_warpIdx++);
    } else {
      deformer_types.push(1); // 1 = rotation
      deformer_specific_indices.push(_rotIdx++);
    }
  }
  sections.set('deformer.ids', deformer_ids);
  sections.set('deformer.keyform_binding_band_indices', deformer_band_indices);
  sections.set('deformer.visibles', deformer_visibles);
  sections.set('deformer.enables', deformer_enables);
  sections.set('deformer.parent_part_indices', deformer_parent_part_indices);
  sections.set('deformer.parent_deformer_indices', deformer_parent_deformer_indices);
  sections.set('deformer.types', deformer_types);
  sections.set('deformer.specific_indices', deformer_specific_indices);

  // ── Warp deformers + their keyforms ──
  // Each warp keyform contributes (cols+1)*(rows+1)*2 floats to keyform_position.
  // Position semantics depend on localFrame: canvas-px frame → normalized by
  // PPU (same convention as mesh vertex positions). normalized-0to1 frame →
  // stored as-is (already in parent's local frame).
  const warp_kf_band_indices = [];
  const warp_kf_begin_indices = [];
  const warp_kf_counts = [];
  const warp_vertex_counts = [];
  const warp_rows = [];
  const warp_cols = [];
  const warp_kf_opacities = [];
  const warp_kf_pos_begin_indices = [];
  let _totalWarpKeyforms = 0;
  for (let i = 0; i < warpSpecs.length; i++) {
    const w = warpSpecs[i];
    const gridPts = (w.gridSize.cols + 1) * (w.gridSize.rows + 1);
    warp_kf_band_indices.push(deformerBandOffset + i);
    warp_kf_begin_indices.push(_totalWarpKeyforms);
    warp_kf_counts.push(w.keyforms.length);
    warp_vertex_counts.push(gridPts);
    warp_rows.push(w.gridSize.rows);
    warp_cols.push(w.gridSize.cols);
    _totalWarpKeyforms += w.keyforms.length;
    for (const kf of w.keyforms) {
      warp_kf_opacities.push(kf.opacity ?? 1);
      // keyform_position_begin_indices is the FLOAT offset into the
      // keyform_position.xys array (mesh code does the same — each XY pair
      // takes 2 floats and offsets accumulate by vertCount * 2).
      warp_kf_pos_begin_indices.push(allKeyformPositions.length);
      // Translate positions to moc3 convention:
      //   - canvas-px frame  → normalize by PPU (same as mesh vertex coords)
      //   - normalized-0to1  → store as-is
      //   - pivot-relative   → canvas-px-from-pivot, normalize by PPU
      for (let pi = 0; pi < kf.positions.length; pi += 2) {
        const lx = kf.positions[pi];
        const ly = kf.positions[pi + 1];
        if (w.localFrame === 'canvas-px') {
          allKeyformPositions.push((lx - originX) / ppu);
          allKeyformPositions.push((ly - originY) / ppu);
        } else if (w.localFrame === 'pivot-relative') {
          allKeyformPositions.push(lx / ppu);
          allKeyformPositions.push(ly / ppu);
        } else {
          allKeyformPositions.push(lx);
          allKeyformPositions.push(ly);
        }
      }
    }
  }
  counts[COUNT_IDX.WARP_DEFORMER_KEYFORMS] = _totalWarpKeyforms;
  sections.set('warp_deformer.keyform_binding_band_indices', warp_kf_band_indices);
  sections.set('warp_deformer.keyform_begin_indices', warp_kf_begin_indices);
  sections.set('warp_deformer.keyform_counts', warp_kf_counts);
  sections.set('warp_deformer.vertex_counts', warp_vertex_counts);
  sections.set('warp_deformer.rows', warp_rows);
  sections.set('warp_deformer.cols', warp_cols);
  sections.set('warp_deformer_keyform.opacities', warp_kf_opacities);
  sections.set('warp_deformer_keyform.keyform_position_begin_indices', warp_kf_pos_begin_indices);

  // ── Rotation deformers + their keyforms ──
  const rot_kf_band_indices = [];
  const rot_kf_begin_indices = [];
  const rot_kf_counts = [];
  const rot_base_angles = [];
  const rot_kf_opacities = [];
  const rot_kf_angles = [];
  const rot_kf_origin_xs = [];
  const rot_kf_origin_ys = [];
  const rot_kf_scales = [];
  const rot_kf_reflect_xs = [];
  const rot_kf_reflect_ys = [];
  let _totalRotKeyforms = 0;
  for (let i = 0; i < rotationSpecs.length; i++) {
    const r = rotationSpecs[i];
    rot_kf_band_indices.push(deformerBandOffset + numWarpDeformers + i);
    rot_kf_begin_indices.push(_totalRotKeyforms);
    rot_kf_counts.push(r.keyforms.length);
    rot_base_angles.push(r.baseAngle ?? 0);
    _totalRotKeyforms += r.keyforms.length;
    for (const kf of r.keyforms) {
      rot_kf_opacities.push(kf.opacity ?? 1);
      rot_kf_angles.push(kf.angle);
      rot_kf_origin_xs.push(kf.originX);
      rot_kf_origin_ys.push(kf.originY);
      rot_kf_scales.push(kf.scale ?? 1);
      rot_kf_reflect_xs.push(kf.reflectX ?? false);
      rot_kf_reflect_ys.push(kf.reflectY ?? false);
    }
  }
  counts[COUNT_IDX.ROTATION_DEFORMER_KEYFORMS] = _totalRotKeyforms;
  sections.set('rotation_deformer.keyform_binding_band_indices', rot_kf_band_indices);
  sections.set('rotation_deformer.keyform_begin_indices', rot_kf_begin_indices);
  sections.set('rotation_deformer.keyform_counts', rot_kf_counts);
  sections.set('rotation_deformer.base_angles', rot_base_angles);
  sections.set('rotation_deformer_keyform.opacities', rot_kf_opacities);
  sections.set('rotation_deformer_keyform.angles', rot_kf_angles);
  sections.set('rotation_deformer_keyform.origin_xs', rot_kf_origin_xs);
  sections.set('rotation_deformer_keyform.origin_ys', rot_kf_origin_ys);
  sections.set('rotation_deformer_keyform.scales', rot_kf_scales);
  sections.set('rotation_deformer_keyform.reflect_xs', rot_kf_reflect_xs);
  sections.set('rotation_deformer_keyform.reflect_ys', rot_kf_reflect_ys);

  // ── Append bone-baked keyform vertex data, then patch sentinels ──
  // Bone-baked meshes contributed sentinel (-1) entries in
  // flatKeyformPosBegin; resolve them by appending each angle's rotated
  // positions and recording the float-offset where they land.
  for (const append of bonePerKeyformAppends) {
    const partIdx = append.partIndex;
    const part = meshParts[partIdx];
    const rigWarp = rigWarpByPartId.get(part.id);
    const offset = allKeyformPositions.length;
    flatKeyformPosBegin[append.flatIndex] = offset;
    // Convert to the same frame as rest-pose vertex positions for this
    // mesh (so deformer chain interpretation stays consistent).
    for (let i = 0; i < append.positions.length; i += 2) {
      const vx = append.positions[i];
      const vy = append.positions[i + 1];
      if (rigWarp) {
        const bb = rigWarp.canvasBbox;
        allKeyformPositions.push((vx - bb.minX) / bb.W);
        allKeyformPositions.push((vy - bb.minY) / bb.H);
      } else if (useDeformerFrame) {
        allKeyformPositions.push(rigSpec.canvasToInnermostX(vx));
        allKeyformPositions.push(rigSpec.canvasToInnermostY(vy));
      } else {
        allKeyformPositions.push((vx - originX) / ppu);
        allKeyformPositions.push((vy - originY) / ppu);
      }
    }
  }
  sections.set('art_mesh_keyform.keyform_position_begin_indices', flatKeyformPosBegin);

  // ── Update keyform_position count + section (extended with warp grids
  // and bone keyforms) ──
  counts[COUNT_IDX.KEYFORM_POSITIONS] = allKeyformPositions.length;
  sections.set('keyform_position.xys', allKeyformPositions);

  // ── Re-parent art meshes to their rig warp (or deepest body warp) ──
  // Each mesh tries to parent to its dedicated rig warp first (per-mesh
  // structural warp from the cmo3 emit); otherwise falls back to the
  // deepest body warp (BodyXWarp).
  //
  // parent_part_indices STAYS at the mesh's group/root part — Cubism uses
  // it for the drawing-tree hierarchy (visibility, draw-order organisation),
  // independent of the deformer chain that handles transformation. cmo3
  // sets meshSrc.parentGuid the same way regardless of any deformer parent.
  if (meshDefaultDeformerIdx >= 0) {
    // Map mesh.partId → deformer index, derived from rig warp targetPartId.
    const partIdToDeformerIdx = new Map();
    for (let i = 0; i < warpSpecs.length; i++) {
      const w = warpSpecs[i];
      if (w.targetPartId) partIdToDeformerIdx.set(w.targetPartId, i);
    }
    sections.set('art_mesh.parent_deformer_indices', meshParts.map(p =>
      partIdToDeformerIdx.get(p.id) ?? meshDefaultDeformerIdx,
    ));
    // Re-emit parent_part_indices to overwrite an earlier set; mesh keeps
    // its group as part parent.
    sections.set('art_mesh.parent_part_indices', meshParts.map(p => {
      if (p.parent && partIdMap.has(p.parent)) return partIdMap.get(p.parent);
      return 0;
    }));

    // Mesh keyform_position frame matches its parent deformer's local frame.
    // For a rig warp parent: its baseGrid is in 0..1 (normalized-0to1) of
    // BodyXWarp/FaceParallax/NeckWarp. The mesh's vertex positions in that
    // frame are the bilinear coords of the vertex within the rig warp's
    // grid bbox. For now we approximate by keeping the canvasToInnermost
    // (BodyXWarp 0..1) projection — visually equivalent at rest pose
    // since the rig warp's grid is itself in BodyXWarp's frame. Refine in
    // Phase D once per-mesh frame analysis is in place.
  }

  // --- Drawable masks (1 dummy entry) ---
  // Replace the dummy entry with the populated clip mask list (if any).
  // SDK validator rejects total=0 with begin<total checks, so when no
  // clips are present we fall back to a single -1 entry.
  if (drawableMaskIndices.length > 0) {
    counts[COUNT_IDX.DRAWABLE_MASKS] = drawableMaskIndices.length;
    sections.set('drawable_mask.art_mesh_indices', drawableMaskIndices);
  } else {
    sections.set('drawable_mask.art_mesh_indices', [-1]);
  }

  // --- UV data ---
  const allUVs = [];
  for (let mi = 0; mi < meshParts.length; mi++) {
    const part = meshParts[mi];
    const mesh = part.mesh;
    const region = regions.get(part.id);
    if (mesh.uvs && region) {
      // Remap UVs from full-PSD space to atlas space.
      // UV is normalized to full source image (0..1 over srcWidth × srcHeight).
      // 1. Convert UV to source pixel: srcPx = uv * srcSize
      // 2. Offset from crop origin: cropLocal = srcPx - cropOrigin
      // 3. Scale to atlas region: atlasLocal = cropLocal / cropSize * regionSize
      // 4. Add atlas position and normalize: finalUV = (regionPos + atlasLocal) / atlasSize
      for (let i = 0; i < mesh.uvs.length; i += 2) {
        const srcPxX = mesh.uvs[i] * region.srcWidth;
        const srcPxY = mesh.uvs[i + 1] * region.srcHeight;
        const localX = (srcPxX - region.srcX) / region.cropW * region.width;
        const localY = (srcPxY - region.srcY) / region.cropH * region.height;
        // Clamp to [0, 1] — mesh vertices can extend slightly outside crop
        // due to 2px dilation in mesh generation (contour.js)
        allUVs.push(Math.max(0, Math.min(1, (region.x + localX) / atlasSize)));
        allUVs.push(Math.max(0, Math.min(1, (region.y + localY) / atlasSize)));
      }
    }
  }
  sections.set('uv.xys', allUVs);

  // --- Position indices (triangle indices) ---
  const allIndices = [];
  for (const part of meshParts) {
    if (part.mesh?.triangles) {
      // triangles is Array<[i, j, k]> — flatten to flat index list
      for (const tri of part.mesh.triangles) {
        allIndices.push(tri[0], tri[1], tri[2]);
      }
    }
  }
  sections.set('position_index.indices', allIndices);

  // --- Draw order groups (Hiyori pattern) ---
  sections.set('draw_order_group.object_begin_indices', [0]);
  sections.set('draw_order_group.object_counts', [numArtMeshes]);
  sections.set('draw_order_group.object_total_counts', [numArtMeshes]);
  sections.set('draw_order_group.min_draw_orders', [1000]);
  sections.set('draw_order_group.max_draw_orders', [200]);

  // --- Draw order group objects ---
  // Render order: reverse of draw_order (highest draw_order = rendered first = behind)
  sections.set('draw_order_group_object.types', meshParts.map(() => 0)); // 0 = ArtMesh
  sections.set('draw_order_group_object.indices',
    meshParts.map((_, i) => numArtMeshes - 1 - i));
  sections.set('draw_order_group_object.group_indices', meshParts.map(() => -1)); // -1 like Hiyori

  // --- Canvas info ---
  // WARNING: `canvas` is declared late. All code above MUST use canvasW/canvasH
  // (declared at top of buildSectionData), NOT canvas.* — JS const is not hoisted.
  // This caused two identical "Cannot access before initialization" crashes.
  const canvas = {
    pixelsPerUnit: Math.max(canvasW, canvasH),
    originX: canvasW / 2,
    originY: canvasH / 2,
    canvasWidth: canvasW,
    canvasHeight: canvasH,
    canvasFlag: 0,
  };

  return { sections, counts, canvas };
}


// ---------------------------------------------------------------------------
// Main writer
// ---------------------------------------------------------------------------

/**
 * Generate a .moc3 binary ArrayBuffer from project data.
 *
 * @param {Moc3Input} input
 * @returns {ArrayBuffer}
 */
export function generateMoc3(input) {
  const { sections, counts, canvas } = buildSectionData(input);

  // V4.00 matches Hiyori reference — confirmed working with Ren'Py 8.5 Cubism SDK
  const version = MOC_VERSION.V4_00;

  // Phase 1: Write body sections, record offsets
  const body = new BinaryWriter();
  const sotEntries = [];

  // SOT[0] — Count Info
  sotEntries.push(DEFAULT_OFFSET + body.pos);
  for (const c of counts) body.writeI32(c);
  // Pad to COUNT_INFO_SIZE
  body.fill(COUNT_INFO_SIZE - counts.length * 4);

  // SOT[1] — Canvas Info
  sotEntries.push(DEFAULT_OFFSET + body.pos);
  body.writeF32(canvas.pixelsPerUnit);
  body.writeF32(canvas.originX);
  body.writeF32(canvas.originY);
  body.writeF32(canvas.canvasWidth);
  body.writeF32(canvas.canvasHeight);
  body.writeU8(canvas.canvasFlag);
  body.fill(CANVAS_INFO_SIZE - (5 * 4 + 1));

  // SOT[2..] — Body sections
  for (const [name, elemType, countIdx, alignment] of SECTION_LAYOUT) {
    // Align if needed
    if (alignment > 0) body.padTo(alignment);

    sotEntries.push(DEFAULT_OFFSET + body.pos);

    const data = sections.get(name) ?? [];
    const count = elemType === ELEM.RUNTIME
      ? (countIdx >= 0 ? counts[countIdx] : 0)
      : data.length;

    writeSection(body, elemType, data, count);
  }

  // V3.03+ additional section: quad_transforms (Bool32 per warp deformer).
  // For V4.00, this is section 100 → SOT[101]. SDK requires the SOT entry
  // be a valid (non-zero) offset. With warp deformers present, the SDK
  // ALSO reads N×4 bytes of bool32 data at the offset; without that data
  // it parses garbage and fails the load. Each entry mirrors the warp's
  // `isQuadTransform` flag (false for all our warps — matches Hiyori).
  if (version >= MOC_VERSION.V3_03) {
    body.padTo(ALIGN);
    sotEntries.push(DEFAULT_OFFSET + body.pos);
    const numWarps = counts[COUNT_IDX.WARP_DEFORMERS];
    for (let i = 0; i < numWarps; i++) body.writeI32(0); // false
  }

  // Phase 2: Assemble header + SOT + padding + body
  const out = new BinaryWriter();

  // Header (64 bytes)
  out.writeU8(MAGIC[0]); out.writeU8(MAGIC[1]); out.writeU8(MAGIC[2]); out.writeU8(MAGIC[3]);
  out.writeU8(version);  // version
  out.writeU8(0);        // endian flag (0 = LE)
  out.fill(HEADER_SIZE - 6); // padding

  // SOT (160 x uint32) — fill remaining with the last valid offset (not 0!)
  // SDK validates that SOT entries for the current version are non-zero valid offsets.
  const lastValidOffset = sotEntries[sotEntries.length - 1] || DEFAULT_OFFSET;
  while (sotEntries.length < SOT_COUNT) sotEntries.push(lastValidOffset);
  out.writeU32Array(sotEntries.slice(0, SOT_COUNT));

  // Pad to DEFAULT_OFFSET
  out.fill(DEFAULT_OFFSET - out.pos);

  // Append body
  const bodyBuf = body.toArrayBuffer();
  const bodyBytes = new Uint8Array(bodyBuf);
  for (const b of bodyBytes) out.writeU8(b);

  // Final 64-byte alignment.
  // All SOT entries now point to valid offsets (filled with lastValidOffset above).
  // SDK requires SOT offsets <= file_size, so we pad to ensure the file extends
  // past the last referenced offset.
  out.padTo(ALIGN);

  return out.toArrayBuffer();
}

/**
 * Write a single section's data.
 *
 * @param {BinaryWriter} w
 * @param {object} elemType - One of the ELEM constants
 * @param {any[]} data
 * @param {number} count
 */
function writeSection(w, elemType, data, count) {
  if (elemType === ELEM.RUNTIME) {
    w.fill(count * RUNTIME_UNIT_SIZE);
  } else if (elemType === ELEM.I32) {
    w.writeI32Array(data);
  } else if (elemType === ELEM.F32) {
    w.writeF32Array(data);
  } else if (elemType === ELEM.I16) {
    w.writeI16Array(data);
  } else if (elemType === ELEM.U8) {
    w.writeU8Array(data);
  } else if (elemType === ELEM.BOOL) {
    w.writeBoolArray(data);
  } else if (elemType === ELEM.STR64) {
    w.writeStringArray(data);
  }
}
