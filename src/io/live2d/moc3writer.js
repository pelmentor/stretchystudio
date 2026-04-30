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
import { resolveMaskConfigs } from './rig/maskConfigs.js';
import {
  MAGIC, HEADER_SIZE, SOT_COUNT, COUNT_INFO_ENTRIES, COUNT_INFO_SIZE,
  CANVAS_INFO_SIZE, DEFAULT_OFFSET, ALIGN, RUNTIME_UNIT_SIZE,
  MOC_VERSION, COUNT_IDX, ELEM, SECTION_LAYOUT,
} from './moc3/layout.js';
import { BinaryWriter } from './moc3/binaryWriter.js';
import { buildMeshBindingPlan } from './moc3/meshBindingPlan.js';
import { topoSortDeformers } from './moc3/deformerOrder.js';
import { buildKeyformBindings } from './moc3/keyformBindings.js';
import { emitKeyformAndDeformerSections } from './moc3/keyformAndDeformerSections.js';


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
  const {
    project, regions, atlasSize, numAtlases, generateRig = true, rigSpec = null,
    bakedKeyformAngles = [-90, -45, 0, 45, 90],
    // Stage 5: variant fade rules (`backdropTags` exempt from base-fade).
    // When absent, falls back to the canonical Hiyori-style backdrop set.
    variantFadeRules = null,
    // Stage 8: rotation deformer config — paramSpec consumes
    // skipRotationRoles + paramAngleRange. Pass-through.
    rotationDeformerConfig = null,
  } = input;

  // Resolve Stage 5 backdrop list to a flat array used inline below.
  const _BACKDROP_TAGS_LIST_MOC3 = (variantFadeRules
    && Array.isArray(variantFadeRules.backdropTags)
    && variantFadeRules.backdropTags.length > 0)
    ? variantFadeRules.backdropTags
    : ['face', 'ears', 'ears-l', 'ears-r', 'front hair', 'back hair'];

  const canvasW = project.canvas?.width ?? 800;
  const canvasH = project.canvas?.height ?? 600;

  const sections = new Map();
  const counts = new Array(COUNT_INFO_ENTRIES).fill(0);

  // Collect parts (groups → Live2D Parts)
  const groups = project.nodes.filter(n => n.type === 'group');
  // Cubism's runtime expects an explicit `__RootPart__` (parent=-1) at
  // index 0 with all groups hanging off it. Without this top-level entry
  // the part hierarchy is malformed and the SDK rejects the file.
  const ROOT_PART = { id: '__RootPart__', name: 'Root', parent: null, opacity: 1, visible: true };
  const partNodes = [ROOT_PART, ...groups];

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
    bakedKeyformAngles,
    rotationDeformerConfig,
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
    // Cubism aligns each keyform's position block to a 16-float boundary
    // (pad with zeros). Must mirror it here — pos_begin offsets must hit
    // 16-aligned values or the runtime reads adjacent keyform data
    // incorrectly. e.g. 36 control pts × 2 floats = 72 → padded to 80.
    const _padded = Math.ceil((renderVertCount * 2) / 16) * 16;
    totalKeyformPositions += _padded;

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
  // See moc3/meshBindingPlan.js for the per-mesh branch order
  // (bone-baked → eye closure → variant fade → base fade → default).
  // Verified by binary diff against cubism native export of shelby.cmo3:
  //   ArtMesh10 (face = backdrop)            → 1 kf, ParamOpacity[1]
  //   ArtMesh9  (face_smile = variant)       → 2 kf, ParamSmile[0,1]
  //   ArtMesh18 (arm = bone-baked)           → 5 kf, ParamRotation_*Elbow
  const BACKDROP_TAGS_SET_MOC3 = new Set(_BACKDROP_TAGS_LIST_MOC3);
  const {
    meshBindingPlan,
    meshKeyformBeginIndex,
    meshKeyformCount,
    totalArtMeshKeyforms,
  } = buildMeshBindingPlan({
    meshParts, groups, rigSpec,
    bakedKeyformAngles,
    backdropTagsSet: BACKDROP_TAGS_SET_MOC3,
  });


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
  const {
    allDeformerSpecs,
    allDeformerKinds,
    allDeformerSrcIndices,
    deformerIdToIndex,
    meshDefaultDeformerIdx,
  } = topoSortDeformers({ warpSpecs, rotationSpecs });

  counts[COUNT_IDX.DEFORMERS] = numDeformers;
  counts[COUNT_IDX.WARP_DEFORMERS] = numWarpDeformers;
  counts[COUNT_IDX.ROTATION_DEFORMERS] = numRotationDeformers;

  // ── Keyform binding system (deduplicated, matches cubism layout) ──
  // See moc3/keyformBindings.js for the full pipeline (dedup pool +
  // contiguous-by-param reorder + band interning + kfbi expansion +
  // per-param ranges). Without dedup the moc3 fails to load (band/
  // binding counts come out 2× cubism's).
  const {
    uniqueBindings,
    meshBandIndex,
    deformerBandIndex,
    bandBegins,
    bandCounts,
    keyformBindingIndices,
    bindingKeysBegin,
    bindingKeysCount,
    flatKeys,
    paramKfbBegin,
    paramKfbCount,
  } = buildKeyformBindings({ meshBindingPlan, allDeformerSpecs, params });
  sections.set('parameter.keyform_binding_begin_indices', paramKfbBegin);
  sections.set('parameter.keyform_binding_counts', paramKfbCount);

  counts[COUNT_IDX.KEYFORM_BINDINGS] = uniqueBindings.length;
  counts[COUNT_IDX.KEYFORM_BINDING_INDICES] = keyformBindingIndices.length;
  counts[COUNT_IDX.KEYS] = flatKeys.length;

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
  // All parts use the null band (band 0, count=0) — parts only carry
  // draw_order keyforms (1 per part), no parameter-driven bindings.
  sections.set('part.keyform_binding_band_indices', partNodes.map(() => 0));
  sections.set('part.keyform_begin_indices', partNodes.map((_, i) => i));
  sections.set('part.keyform_counts', partNodes.map(() => 1));
  sections.set('part.visibles', partNodes.map(p => p.visible !== false));
  sections.set('part.enables', partNodes.map(() => true));
  sections.set('part.parent_part_indices', partNodes.map((p, i) => {
    if (i === 0) return -1;                                        // __RootPart__
    if (p.parent && partIdMap.has(p.parent)) return partIdMap.get(p.parent);
    return 0;                                                       // group with no parent → root part
  }));

  // --- ArtMesh sections ---
  sections.set('art_mesh.ids', meshParts.map((p, i) => `ArtMesh${i}`));
  // Each mesh gets its own binding band (band i → mesh i)
  // Each mesh references its band — bands are deduped in `bandPool` so
  // multiple meshes with identical (paramId, keys) share the same index.
  sections.set('art_mesh.keyform_binding_band_indices', meshBandIndex);
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
  // Pairings come from the native rig field `project.maskConfigs` if
  // populated (Stage 3 seeded path), else from the heuristic in
  // `rig/maskConfigs.js` (today's path — iris↔eyewhite, variant-aware).
  // Cubism applies the mask's alpha for clipping, so variant iris must
  // pair with variant eyewhite (matching suffix) to avoid vanishing
  // when its Param<Suffix>=1 fades the base eyewhite.
  const meshIndexById = new Map();
  for (let mi = 0; mi < meshParts.length; mi++) {
    meshIndexById.set(meshParts[mi].id, mi);
  }
  const maskPairs = resolveMaskConfigs(project);
  const drawableMaskIndices = [];
  const meshMaskBegin = new Array(meshParts.length).fill(0);
  const meshMaskCount = new Array(meshParts.length).fill(0);
  for (const pair of maskPairs) {
    const mi = meshIndexById.get(pair.maskedMeshId);
    if (mi == null) continue;
    const resolvedMaskIndices = [];
    for (const maskMeshId of pair.maskMeshIds ?? []) {
      const maskIdx = meshIndexById.get(maskMeshId);
      if (maskIdx != null) resolvedMaskIndices.push(maskIdx);
    }
    if (resolvedMaskIndices.length === 0) continue;
    meshMaskBegin[mi] = drawableMaskIndices.length;
    meshMaskCount[mi] = resolvedMaskIndices.length;
    for (const idx of resolvedMaskIndices) drawableMaskIndices.push(idx);
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


  // --- Part Keyform sections ---
  // Draw orders: all 500.0 (Hiyori pattern — actual order via draw_order_group_object)
  sections.set('part_keyform.draw_orders', partNodes.map(() => 500.0));

  // --- ArtMesh keyforms + deformer sections + keyform positions ---
  // See moc3/keyformAndDeformerSections.js for the interleaved emit
  // pipeline (mesh kf flatten → mesh kf positions → umbrella deformer.*
  // → warp_deformer.* + grid append → rotation_deformer.* → bone kf
  // sentinel patch). Single accumulator; cannot be cleanly subdivided.
  const kfd = emitKeyformAndDeformerSections({
    meshParts, meshBindingPlan, meshInfos,
    rigSpec, warpSpecs, rotationSpecs,
    allDeformerSpecs, allDeformerKinds, allDeformerSrcIndices,
    deformerIdToIndex, deformerBandIndex, meshDefaultDeformerIdx,
    groups,
    canvasW, canvasH,
  });
  sections.set('art_mesh_keyform.opacities', kfd.flatOpacities);
  sections.set('art_mesh_keyform.draw_orders', kfd.flatDrawOrders);
  sections.set('art_mesh_keyform.keyform_position_begin_indices', kfd.flatKeyformPosBegin);
  sections.set('deformer.ids', kfd.deformerIds);
  sections.set('deformer.keyform_binding_band_indices', kfd.deformerBandIndices);
  sections.set('deformer.visibles', kfd.deformerVisibles);
  sections.set('deformer.enables', kfd.deformerEnables);
  sections.set('deformer.parent_part_indices', kfd.deformerParentParts);
  sections.set('deformer.parent_deformer_indices', kfd.deformerParentDeformers);
  sections.set('deformer.types', kfd.deformerTypes);
  sections.set('deformer.specific_indices', kfd.deformerSpecificIndices);
  sections.set('warp_deformer.keyform_binding_band_indices', kfd.warpKfBandIndices);
  sections.set('warp_deformer.keyform_begin_indices', kfd.warpKfBeginIndices);
  sections.set('warp_deformer.keyform_counts', kfd.warpKfCounts);
  sections.set('warp_deformer.vertex_counts', kfd.warpVertexCounts);
  sections.set('warp_deformer.rows', kfd.warpRows);
  sections.set('warp_deformer.cols', kfd.warpCols);
  sections.set('warp_deformer_keyform.opacities', kfd.warpKfOpacities);
  sections.set('warp_deformer_keyform.keyform_position_begin_indices', kfd.warpKfPosBeginIndices);
  counts[COUNT_IDX.WARP_DEFORMER_KEYFORMS] = kfd.totalWarpKeyforms;
  sections.set('rotation_deformer.keyform_binding_band_indices', kfd.rotKfBandIndices);
  sections.set('rotation_deformer.keyform_begin_indices', kfd.rotKfBeginIndices);
  sections.set('rotation_deformer.keyform_counts', kfd.rotKfCounts);
  sections.set('rotation_deformer.base_angles', kfd.rotBaseAngles);
  sections.set('rotation_deformer_keyform.opacities', kfd.rotKfOpacities);
  sections.set('rotation_deformer_keyform.angles', kfd.rotKfAngles);
  sections.set('rotation_deformer_keyform.origin_xs', kfd.rotKfOriginXs);
  sections.set('rotation_deformer_keyform.origin_ys', kfd.rotKfOriginYs);
  sections.set('rotation_deformer_keyform.scales', kfd.rotKfScales);
  sections.set('rotation_deformer_keyform.reflect_xs', kfd.rotKfReflectXs);
  sections.set('rotation_deformer_keyform.reflect_ys', kfd.rotKfReflectYs);
  counts[COUNT_IDX.ROTATION_DEFORMER_KEYFORMS] = kfd.totalRotKeyforms;
  counts[COUNT_IDX.KEYFORM_POSITIONS] = kfd.allKeyformPositions.length;
  sections.set('keyform_position.xys', kfd.allKeyformPositions);

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
    // Map mesh.partId → UNIFIED deformer index (post-topo-sort).
    // art_mesh.parent_deformer_indices references the umbrella deformer.*
    // array — using warpSpecs's natural index here pointed meshes at the
    // wrong deformer entirely (severe misrendering with arms swapped, body
    // collapsed). Resolving via deformerIdToIndex keeps the topo-sorted
    // order honoured.
    const partIdToDeformerIdx = new Map();
    for (const w of warpSpecs) {
      if (!w.targetPartId) continue;
      const ui = deformerIdToIndex.get(w.id);
      if (ui != null) partIdToDeformerIdx.set(w.targetPartId, ui);
    }
    // Map groupId → group rotation deformer's UNIFIED index. Bone-baked
    // meshes (arms / legs) parent to their bone's parent group's rotation
    // deformer (matches cmo3's `dfOwner = boneGroup.parent`); non-rig-warp
    // meshes parent to their own group's rotation deformer when one exists.
    const groupIdToRotIdx = new Map();
    for (const r of rotationSpecs) {
      if (!r.id?.startsWith('GroupRotation_')) continue;
      const gid = r.id.substring('GroupRotation_'.length);
      const ui = deformerIdToIndex.get(r.id);
      if (ui != null) groupIdToRotIdx.set(gid, ui);
    }
    sections.set('art_mesh.parent_deformer_indices', meshParts.map(p => {
      // 1. Mesh has its own rig warp → parent to it.
      const fromRigWarp = partIdToDeformerIdx.get(p.id);
      if (fromRigWarp != null) return fromRigWarp;
      // 2. Bone-baked mesh → bone's parent group's rotation deformer.
      const jointBoneId = p.mesh?.jointBoneId;
      if (jointBoneId && p.mesh?.boneWeights) {
        const boneGroup = groups.find(g => g.id === jointBoneId);
        const armGroupId = boneGroup?.parent;
        if (armGroupId && groupIdToRotIdx.has(armGroupId)) {
          return groupIdToRotIdx.get(armGroupId);
        }
      }
      // 3. Mesh's own group's rotation deformer.
      if (p.parent && groupIdToRotIdx.has(p.parent)) {
        return groupIdToRotIdx.get(p.parent);
      }
      // 4. Fallback: deepest body warp (root of the chain).
      return meshDefaultDeformerIdx;
    }));
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
