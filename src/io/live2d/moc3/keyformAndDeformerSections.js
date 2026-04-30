// @ts-nocheck

/**
 * Mesh keyform positions + deformer sections + warp/rotation keyforms
 * — the whole interleaved emit pipeline.
 *
 * Lifted out of moc3writer.js (Phase 6 god-class breakup, sweep #38).
 *
 * The four passes share one `allKeyformPositions` accumulator and
 * cannot be cleanly split:
 *
 *   1. **Mesh keyform position emit** — for each mesh, frame-convert
 *      its rest-pose vertices to the parent deformer's local frame
 *      and append. Padded to 16 floats per keyform (Cubism alignment).
 *      Frame selection cascade:
 *        - Per-mesh rig warp → 0..1 of rig warp's `canvasBbox`.
 *        - Group rotation deformer parent → raw canvas-px offsets
 *          from the group's pivot (NOT PPU-normalised; cubism stores
 *          arm values like (-38.9, -88.4) directly).
 *        - BodyXWarp / chain root → `rigSpec.canvasToInnermostX/Y`.
 *        - Legacy fallback → centred + PPU-normalised.
 *
 *   2. **Umbrella deformer.* section** — `parent_deformer_indices`
 *      uses the topo-sorted unified index; `parent_part_indices`
 *      defaults to 0 (root part). Orphan deformers (rig-warp's
 *      named parent missing from rigSpec) attach to the deepest body
 *      warp instead.
 *
 *   3. **Warp deformer + warp_deformer_keyform** — for each warp
 *      spec, record posBegin then append the grid. Grid frame
 *      depends on `localFrame`:
 *        - `'canvas-px'` → centred + PPU-normalised.
 *        - `'pivot-relative'` → raw (offsets from rotation pivot).
 *        - default (normalized-0to1) → as-is.
 *
 *   4. **Rotation deformer + rotation_deformer_keyform** — metadata
 *      only (angles + origins). `keyform.scales` is the frame-
 *      conversion factor from child's pivot-relative pixel offsets
 *      to the parent's frame:
 *        - parent='warp'      → `1 / canvasMaxDim`
 *        - parent='rotation'  → `1.0`
 *        - parent='root'      → `1.0`
 *      Without this scaling chains like
 *      face → RigWarp_face → FaceParallax → FaceRotation → Rotation_head → BodyXWarp
 *      produce results 1792× too large.
 *
 *   5. **Bone keyform sentinel patch** — keyforms with
 *      `perVertexPositions != null` (bone-baked or eye-closure)
 *      contributed `-1` sentinels to `flatKeyformPosBegin` in step 1.
 *      Now append their per-keyform vertex blocks (frame-converted
 *      the same way as rest-pose) and patch the sentinel offsets.
 *
 * Returns the populated section bundles for the caller to dispatch
 * into the unified sections Map + counts array. No side effects on
 * caller state.
 *
 * @module io/live2d/moc3/keyformAndDeformerSections
 */

/**
 * @param {Object} opts
 */
export function emitKeyformAndDeformerSections(opts) {
  const {
    meshParts, meshBindingPlan, meshInfos,
    rigSpec, warpSpecs, rotationSpecs,
    allDeformerSpecs, allDeformerKinds, allDeformerSrcIndices,
    deformerIdToIndex, deformerBandIndex, meshDefaultDeformerIdx,
    groups,
    canvasW, canvasH,
  } = opts;

  const ppu = Math.max(canvasW, canvasH);
  const originX = canvasW / 2;
  const originY = canvasH / 2;
  const useDeformerFrame = !!(rigSpec && rigSpec.canvasToInnermostX && meshDefaultDeformerIdx >= 0);

  // partId → rig warp spec (for per-mesh frame conversion).
  const rigWarpByPartId = new Map();
  if (rigSpec) {
    for (const w of warpSpecs) {
      if (w.targetPartId && w.canvasBbox) rigWarpByPartId.set(w.targetPartId, w);
    }
  }

  // Resolve a mesh's owning group rotation deformer's pivot.
  // Mirrors the parent_deformer_indices logic so frames match parent.
  const groupRotationPivot = (part) => {
    const jointBoneId = part.mesh?.jointBoneId;
    if (jointBoneId && part.mesh?.boneWeights) {
      const boneGroup = groups.find(g => g.id === jointBoneId);
      const armGroupId = boneGroup?.parent;
      if (armGroupId) {
        const armGroup = groups.find(g => g.id === armGroupId);
        if (armGroup?.transform) return { x: armGroup.transform.pivotX ?? 0, y: armGroup.transform.pivotY ?? 0 };
      }
    }
    if (part.parent) {
      const ownGroup = groups.find(g => g.id === part.parent);
      if (ownGroup?.transform && rigSpec?.rotationDeformers?.some(r => r.id === `GroupRotation_${part.parent}`)) {
        return { x: ownGroup.transform.pivotX ?? 0, y: ownGroup.transform.pivotY ?? 0 };
      }
    }
    return null;
  };

  // 16-float padding (Cubism keyform-block alignment).
  const padTo16 = (arr) => {
    while (arr.length % 16 !== 0) arr.push(0);
  };

  // ── 1a. ArtMesh keyform flatten (opacity/drawOrder/posBegin) ──
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
        // Sentinel — patched in step 5 after warp keyforms append.
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

  // ── 1b. Mesh keyform_position append (per-vertex rest pose, frame-converted) ──
  const allKeyformPositions = [];
  for (const part of meshParts) {
    if (!part.mesh?.vertices) continue;
    const rigWarp = rigWarpByPartId.get(part.id);
    const rotPivot = !rigWarp ? groupRotationPivot(part) : null;
    for (const vert of part.mesh.vertices) {
      if (rigWarp) {
        const bb = rigWarp.canvasBbox;
        allKeyformPositions.push((vert.x - bb.minX) / bb.W);
        allKeyformPositions.push((vert.y - bb.minY) / bb.H);
      } else if (rotPivot) {
        allKeyformPositions.push(vert.x - rotPivot.x);
        allKeyformPositions.push(vert.y - rotPivot.y);
      } else if (useDeformerFrame) {
        allKeyformPositions.push(rigSpec.canvasToInnermostX(vert.x));
        allKeyformPositions.push(rigSpec.canvasToInnermostY(vert.y));
      } else {
        allKeyformPositions.push((vert.x - originX) / ppu);
        allKeyformPositions.push((vert.y - originY) / ppu);
      }
    }
    padTo16(allKeyformPositions);
  }

  // ── 2. Umbrella deformer.* sections ──
  const deformerIds = [];
  const deformerBandIndices = [];
  const deformerVisibles = [];
  const deformerEnables = [];
  const deformerParentParts = [];
  const deformerParentDeformers = [];
  const deformerTypes = [];
  const deformerSpecificIndices = [];
  for (let d = 0; d < allDeformerSpecs.length; d++) {
    const spec = allDeformerSpecs[d];
    deformerIds.push(spec.id);
    deformerBandIndices.push(deformerBandIndex[d]);
    deformerVisibles.push(spec.isVisible !== false);
    deformerEnables.push(true);
    let pp = 0;
    let pd = -1;
    if (spec.parent.type === 'warp' || spec.parent.type === 'rotation') {
      pd = deformerIdToIndex.get(spec.parent.id) ?? -1;
      // Orphan deformer (rig-warp's named parent missing from rigSpec)
      // → attach to deepest body warp.
      if (pd < 0 && meshDefaultDeformerIdx >= 0) pd = meshDefaultDeformerIdx;
    }
    deformerParentParts.push(pp);
    deformerParentDeformers.push(pd);
    deformerTypes.push(allDeformerKinds[d] === 'warp' ? 0 : 1);
    deformerSpecificIndices.push(allDeformerSrcIndices[d]);
  }

  // ── 3. Warp deformers + their keyforms (extends allKeyformPositions) ──
  const warpKfBandIndices = [];
  const warpKfBeginIndices = [];
  const warpKfCounts = [];
  const warpVertexCounts = [];
  const warpRows = [];
  const warpCols = [];
  const warpKfOpacities = [];
  const warpKfPosBeginIndices = [];
  let totalWarpKeyforms = 0;
  for (let i = 0; i < warpSpecs.length; i++) {
    const w = warpSpecs[i];
    const gridPts = (w.gridSize.cols + 1) * (w.gridSize.rows + 1);
    const uidx = deformerIdToIndex.get(w.id) ?? 0;
    warpKfBandIndices.push(deformerBandIndex[uidx] ?? 0);
    warpKfBeginIndices.push(totalWarpKeyforms);
    warpKfCounts.push(w.keyforms.length);
    warpVertexCounts.push(gridPts);
    warpRows.push(w.gridSize.rows);
    warpCols.push(w.gridSize.cols);
    totalWarpKeyforms += w.keyforms.length;
    for (const kf of w.keyforms) {
      warpKfOpacities.push(kf.opacity ?? 1);
      // Float-offset into keyform_position.xys (each XY pair = 2 floats).
      warpKfPosBeginIndices.push(allKeyformPositions.length);
      for (let pi = 0; pi < kf.positions.length; pi += 2) {
        const lx = kf.positions[pi];
        const ly = kf.positions[pi + 1];
        if (w.localFrame === 'canvas-px') {
          allKeyformPositions.push((lx - originX) / ppu);
          allKeyformPositions.push((ly - originY) / ppu);
        } else if (w.localFrame === 'pivot-relative') {
          allKeyformPositions.push(lx);
          allKeyformPositions.push(ly);
        } else {
          allKeyformPositions.push(lx);
          allKeyformPositions.push(ly);
        }
      }
      padTo16(allKeyformPositions);
    }
  }

  // ── 4. Rotation deformers + their keyforms ──
  const rotKfBandIndices = [];
  const rotKfBeginIndices = [];
  const rotKfCounts = [];
  const rotBaseAngles = [];
  const rotKfOpacities = [];
  const rotKfAngles = [];
  const rotKfOriginXs = [];
  const rotKfOriginYs = [];
  const rotKfScales = [];
  const rotKfReflectXs = [];
  const rotKfReflectYs = [];
  const canvasMaxDim = Math.max(canvasW, canvasH);
  let totalRotKeyforms = 0;
  for (let i = 0; i < rotationSpecs.length; i++) {
    const r = rotationSpecs[i];
    const uidx = deformerIdToIndex.get(r.id) ?? 0;
    rotKfBandIndices.push(deformerBandIndex[uidx] ?? 0);
    rotKfBeginIndices.push(totalRotKeyforms);
    rotKfCounts.push(r.keyforms.length);
    rotBaseAngles.push(r.baseAngle ?? 0);
    totalRotKeyforms += r.keyforms.length;
    const scaleFactor = r.parent?.type === 'warp'
      ? 1 / canvasMaxDim
      : 1.0;
    for (const kf of r.keyforms) {
      rotKfOpacities.push(kf.opacity ?? 1);
      rotKfAngles.push(kf.angle);
      rotKfOriginXs.push(kf.originX);
      rotKfOriginYs.push(kf.originY);
      rotKfScales.push(scaleFactor);
      rotKfReflectXs.push(kf.reflectX ?? false);
      rotKfReflectYs.push(kf.reflectY ?? false);
    }
  }

  // ── 5. Bone keyform sentinel patch (extends allKeyformPositions) ──
  for (const append of bonePerKeyformAppends) {
    const partIdx = append.partIndex;
    const part = meshParts[partIdx];
    const rigWarp = rigWarpByPartId.get(part.id);
    const rotPivot = !rigWarp ? groupRotationPivot(part) : null;
    const offset = allKeyformPositions.length;
    flatKeyformPosBegin[append.flatIndex] = offset;
    for (let i = 0; i < append.positions.length; i += 2) {
      const vx = append.positions[i];
      const vy = append.positions[i + 1];
      if (rigWarp) {
        const bb = rigWarp.canvasBbox;
        allKeyformPositions.push((vx - bb.minX) / bb.W);
        allKeyformPositions.push((vy - bb.minY) / bb.H);
      } else if (rotPivot) {
        allKeyformPositions.push(vx - rotPivot.x);
        allKeyformPositions.push(vy - rotPivot.y);
      } else if (useDeformerFrame) {
        allKeyformPositions.push(rigSpec.canvasToInnermostX(vx));
        allKeyformPositions.push(rigSpec.canvasToInnermostY(vy));
      } else {
        allKeyformPositions.push((vx - originX) / ppu);
        allKeyformPositions.push((vy - originY) / ppu);
      }
    }
    padTo16(allKeyformPositions);
  }

  return {
    // Mesh kf flatten
    flatOpacities, flatDrawOrders, flatKeyformPosBegin,
    // Umbrella deformer.*
    deformerIds, deformerBandIndices, deformerVisibles, deformerEnables,
    deformerParentParts, deformerParentDeformers, deformerTypes, deformerSpecificIndices,
    // warp_deformer.* + warp_deformer_keyform.*
    warpKfBandIndices, warpKfBeginIndices, warpKfCounts,
    warpVertexCounts, warpRows, warpCols, warpKfOpacities, warpKfPosBeginIndices,
    totalWarpKeyforms,
    // rotation_deformer.* + rotation_deformer_keyform.*
    rotKfBandIndices, rotKfBeginIndices, rotKfCounts, rotBaseAngles,
    rotKfOpacities, rotKfAngles, rotKfOriginXs, rotKfOriginYs, rotKfScales,
    rotKfReflectXs, rotKfReflectYs,
    totalRotKeyforms,
    // Combined keyform_position.xys
    allKeyformPositions,
    // Pre-computed lookup maps shared with mesh→deformer reparent (sweep #39)
    rigWarpByPartId,
  };
}
