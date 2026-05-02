/**
 * Build a v3 RigSpec directly from an authored cmo3 ExtractedScene.
 *
 * This is the **authored path** for rig initialization (per
 * [docs/INIT_RIG_AUTHORED_REWRITE.md](../../../../docs/INIT_RIG_AUTHORED_REWRITE.md)).
 * Used when a project was loaded from a cmo3 file — `cmo3Import.js` stashes
 * the scene on `project._cmo3Scene` and `initializeRigFromProject` routes
 * here instead of running the heuristic `generateCmo3` pass.
 *
 * Why this exists: the heuristic init rig (cmo3writer.js inline body warp
 * chain + face parallax + face rotation pivot) regenerates rig data from
 * face/topwear bbox heuristics, which differ from what the cmo3 author put
 * in the file. Stage 1 of the Phase 2b investigation surfaced ~12 px
 * FaceRotation pivot offset between v3's heuristic and Cubism's authored
 * rig on shelby; the disproof in `verify_pivot_fix.mjs` showed that
 * patching one deformer's origin can't close the gap (constant translation
 * is cancelled by the harness's rest-delta subtraction). The fix is to
 * use the authored values **end-to-end** — every warp + rotation in the
 * chain comes straight from the cmo3 data, no heuristic synthesis.
 *
 * Frame conventions (all preserved verbatim from the cmo3):
 *   - Warp keyform positions: in PARENT's input frame.
 *     - Parent = root → canvas-px.
 *     - Parent = warp → 0..1 of parent warp's input domain.
 *     - Parent = rotation → pivot-relative-canvas-px from parent rotation pivot.
 *   - Rotation keyform origins: in PARENT's input frame, same per-parent-type
 *     conventions as warp positions.
 *
 * v3's chainEval already evaluates these conventions correctly (verified by
 * Phase 0/1/3 oracle harness and the Stage 1 J⁻¹ ≡ slope measurement). The
 * problem was always v3's heuristic init rig producing values that didn't
 * match what authored chains expect.
 *
 * @module io/live2d/rig/buildRigSpecFromCmo3
 */

import { evalWarpKernelCubism } from '../runtime/evaluator/cubismWarpEval.js';
import { matchTag } from '../../armatureOrganizer.js';

/**
 * Build a complete RigSpec from a cmo3 ExtractedScene + project state.
 *
 * @param {Object} input
 * @param {import('../cmo3PartExtract.js').ExtractedScene} input.scene
 * @param {Object} input.project                      v3 project (post-cmo3Import)
 * @param {Array} input.meshes                        output of buildMeshesForRig
 * @param {number} input.canvasW
 * @param {number} input.canvasH
 * @returns {{rigSpec: import('./rigSpec.js').RigSpec, debug: Object}}
 */
export function buildRigSpecFromCmo3({ scene, project, meshes, canvasW, canvasH }) {
  // ── Resolve binding GUID → paramId map ──────────────────────────────
  // Each KeyformBindingSource carries the parameter via xs.ref to a
  // CParameterGuid. The writer stamps the param idStr on the binding's
  // `description` field; that's what rigWarpSynth.js already uses.
  /** @type {Map<string, {paramId: string, keys: number[], interpolation: string}>} */
  const bindingByXsId = new Map();
  for (const b of scene.keyformBindings) {
    if (!b.xsId) continue;
    bindingByXsId.set(b.xsId, {
      paramId: b.description || 'ParamOpacity',
      keys: b.keys.slice(),
      interpolation: b.interpolation || 'LINEAR',
    });
  }

  // ── Resolve deformer GUID → idStr ───────────────────────────────────
  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedDeformer>} */
  const deformerByGuid = new Map();
  for (const d of scene.deformers) {
    if (d.ownGuidRef) deformerByGuid.set(d.ownGuidRef, d);
  }

  // ── Resolve KeyformGrid → owning deformer ───────────────────────────
  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedKeyformGrid>} */
  const gridByXsId = new Map();
  for (const g of scene.keyformGrids) {
    if (g.xsId) gridByXsId.set(g.xsId, g);
  }

  // ── Topological sort of deformers (parents before children) ─────────
  // Parents reference children via parentDeformerGuidRef. Some root-level
  // deformers (e.g. BodyWarpZ) point at a CPartGuid (the rootPart) which
  // resolves to no known deformer — treat those as root-parented.
  // Walk Kahn-style: deformers whose parent is resolved (or null/external)
  // go to the output; loop until stable.
  const remaining = new Set(scene.deformers);
  const ordered = [];
  const placedGuids = new Set();
  let progress = true;
  while (progress && remaining.size > 0) {
    progress = false;
    for (const d of [...remaining]) {
      const parentRef = d.parentDeformerGuidRef;
      // parentReady when:
      //   - no parentRef (truly root-parented)
      //   - parentRef points to a deformer we've already placed
      //   - parentRef points outside the deformer set (e.g. rootPart guid)
      const parentExistsAsDeformer = parentRef && deformerByGuid.has(parentRef);
      const parentReady = !parentRef || !parentExistsAsDeformer || placedGuids.has(parentRef);
      if (parentReady) {
        ordered.push(d);
        if (d.ownGuidRef) placedGuids.add(d.ownGuidRef);
        remaining.delete(d);
        progress = true;
      }
    }
  }
  if (remaining.size > 0) {
    // Cycle or unresolved parent — append remaining anyway with a warning.
    for (const d of remaining) ordered.push(d);
  }

  // ── Build warp + rotation specs in topo order ───────────────────────
  /** @type {import('./rigSpec.js').WarpDeformerSpec[]} */
  const warpDeformers = [];
  /** @type {import('./rigSpec.js').RotationDeformerSpec[]} */
  const rotationDeformers = [];

  for (const d of ordered) {
    const parent = resolveParent(d, deformerByGuid);

    // Resolve which bindings drive this deformer's keyform grid (for
    // the `bindings` array on the spec) + reconstruct keyform list in
    // cross-product order. Cmo3's keyform grid stores cells with
    // accessKeys; we need to flatten to the v3 keyTuple-ordered list.
    const grid = d.keyformGridSourceRef ? gridByXsId.get(d.keyformGridSourceRef) : null;
    const { bindings, keyforms } = buildKeyformsFromGrid({
      deformer: d,
      grid,
      bindingByXsId,
    });

    if (d.kind === 'warp') {
      // Choose a base grid: the first keyform's positions if no top-level.
      const baseGrid = d.positions
        ? new Float64Array(d.positions)
        : (keyforms[0]?.positions ? new Float64Array(keyforms[0].positions) : null);
      if (!baseGrid) continue;
      warpDeformers.push({
        id: d.idStr,
        name: d.name || d.idStr,
        parent,
        gridSize: { rows: d.rows, cols: d.cols },
        baseGrid,
        localFrame: parentLocalFrame(parent),
        bindings,
        keyforms: keyforms.map(kf => ({
          keyTuple: kf.keyTuple,
          positions: new Float64Array(kf.positions ?? baseGrid),
          opacity: 1,
        })),
        isVisible: true,
        isLocked: false,
        isQuadTransform: d.isQuadTransform === true,
      });
    } else if (d.kind === 'rotation') {
      rotationDeformers.push({
        id: d.idStr,
        name: d.name || d.idStr,
        parent,
        bindings,
        keyforms: keyforms.map(kf => ({
          keyTuple: kf.keyTuple,
          angle: kf.angle ?? 0,
          originX: kf.originX ?? 0,
          originY: kf.originY ?? 0,
          scale: kf.scale ?? 1,
          reflectX: false,
          reflectY: false,
          opacity: 1,
        })),
        baseAngle: 0,
        handleLengthOnCanvas: 200,
        circleRadiusOnCanvas: 100,
        isVisible: true,
        isLocked: false,
        useBoneUiTestImpl: d.useBoneUi === true,
      });
    }
  }

  // ── Compute lifted REST canvas-px state for every deformer ──────────
  // Each warp gets a `liftedAtRest` (Float64Array of canvas-px control
  // points). Each rotation gets `restCanvasPivot` (canvas-px). Used by:
  //   - artmesh frame conversion: canvas-px verts → leaf warp UV / rotation
  //     pivot-relative.
  //   - canvasToInnermostX/Y derivation.
  /** @type {Map<string, {kind:'warp', lifted:Float64Array, bbox:{minX,minY,maxX,maxY}, gridSize:{rows,cols}, isQuad:boolean}>} */
  const warpRest = new Map();
  /** @type {Map<string, {kind:'rotation', pivot:{x,y}}>} */
  const rotationRest = new Map();
  // Walk in topo order (parents before children) so warps with rotation
  // parents and rotations with warp parents both have their dependencies
  // resolved. `ordered` was already topo-sorted above by parentDeformerGuidRef.
  /** @type {Map<string, import('./rigSpec.js').WarpDeformerSpec>} */
  const warpById = new Map(warpDeformers.map(w => [w.id, w]));
  /** @type {Map<string, import('./rigSpec.js').RotationDeformerSpec>} */
  const rotById = new Map(rotationDeformers.map(r => [r.id, r]));
  for (const d of ordered) {
    if (d.kind === 'warp') {
      const w = warpById.get(d.idStr);
      if (!w) continue;
      const lifted = liftWarpToCanvasAtRest(w, warpDeformers, rotationRest, warpRest);
      if (!lifted) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < lifted.length; i += 2) {
        const x = lifted[i], y = lifted[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      warpRest.set(w.id, { kind: 'warp', lifted, bbox: { minX, minY, maxX, maxY }, gridSize: w.gridSize, isQuad: w.isQuadTransform === true });
    } else if (d.kind === 'rotation') {
      const r = rotById.get(d.idStr);
      if (!r) continue;
      const pivot = computeRotationCanvasPivotAtRest(r, warpRest, rotationRest);
      if (pivot) rotationRest.set(r.id, { kind: 'rotation', pivot });
    }
  }

  // ── Build artMeshes from project meshes + cmo3 part deformerGuidRef ─
  /** @type {import('./rigSpec.js').ArtMeshSpec[]} */
  const artMeshes = [];
  // Index parts by their xsId so we can match meshes (which reference
  // project node ids) back to scene parts. The mesh order from
  // buildMeshesForRig is "draw_order desc" of project nodes; scene.parts
  // is in cmo3 file order. They don't necessarily match.
  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedPart>} */
  const partByDrawableIdStr = new Map();
  for (const part of scene.parts) partByDrawableIdStr.set(part.drawableIdStr, part);
  // The project nodes that became part of meshes have an `id` from uid()
  // — to back-link to scene.parts, the cmo3Import would need to stash
  // the original drawableIdStr on the node. Lookup by name is fragile but
  // shelby's mesh names are unique. Build a name→part map.
  /** @type {Map<string, import('../cmo3PartExtract.js').ExtractedPart>} */
  const partByName = new Map();
  for (const part of scene.parts) {
    if (part.name && !partByName.has(part.name)) partByName.set(part.name, part);
  }

  for (let i = 0; i < meshes.length; i++) {
    const m = meshes[i];
    // Find the matching cmo3 part by name. (Project nodes inherit the
    // mesh name from cmo3 part on import.) Falls back to positional match.
    const part = partByName.get(m.name) ?? scene.parts[i];
    const parentDef = part?.deformerGuidRef ? deformerByGuid.get(part.deformerGuidRef) : null;
    const parent = parentDef
      ? { type: parentDef.kind, id: parentDef.idStr }
      : { type: 'root', id: null };

    // Frame-convert the canvas-px verts to PARENT'S input frame:
    //   - parent=warp:    verts in [0..1] of warp's lifted-rest bbox
    //   - parent=rotation: verts in canvas-px relative to rotation pivot
    //   - parent=root:    verts stay canvas-px
    const verts = new Float32Array(m.vertices.length);
    if (parentDef?.kind === 'warp') {
      const restState = warpRest.get(parentDef.idStr);
      if (restState) {
        const { minX, minY, maxX, maxY } = restState.bbox;
        const w = (maxX - minX) || 1;
        const h = (maxY - minY) || 1;
        for (let v = 0; v < m.vertices.length; v += 2) {
          verts[v]     = (m.vertices[v]     - minX) / w;
          verts[v + 1] = (m.vertices[v + 1] - minY) / h;
        }
      } else {
        for (let v = 0; v < m.vertices.length; v++) verts[v] = m.vertices[v];
      }
    } else if (parentDef?.kind === 'rotation') {
      const restState = rotationRest.get(parentDef.idStr);
      if (restState) {
        const { x: px, y: py } = restState.pivot;
        for (let v = 0; v < m.vertices.length; v += 2) {
          verts[v]     = m.vertices[v]     - px;
          verts[v + 1] = m.vertices[v + 1] - py;
        }
      } else {
        for (let v = 0; v < m.vertices.length; v++) verts[v] = m.vertices[v];
      }
    } else {
      for (let v = 0; v < m.vertices.length; v++) verts[v] = m.vertices[v];
    }

    artMeshes.push({
      id: m.partId ?? `mesh_${i}`,
      name: m.name,
      parent,
      verticesCanvas: new Float32Array(m.vertices),
      triangles: new Uint16Array(m.triangles),
      uvs: new Float32Array(m.uvs),
      variantSuffix: m.variantSuffix ?? null,
      textureId: m.partId ?? null,
      bindings: [],
      keyforms: [{
        keyTuple: [],
        vertexPositions: verts,
        opacity: 1,
        drawOrder: m.drawOrder ?? 0,
      }],
      maskMeshIds: m.maskMeshIds ?? [],
      isVisible: true,
      drawOrder: m.drawOrder ?? 0,
    });
  }

  // ── Compute canvasToInnermostX/Y from authored body warp chain ──────
  const innermostBodyWarpId = detectInnermostBodyWarp(warpDeformers, rotationDeformers);
  let canvasToInnermostX = null;
  let canvasToInnermostY = null;
  if (innermostBodyWarpId && warpRest.has(innermostBodyWarpId)) {
    const { minX, minY, maxX, maxY } = warpRest.get(innermostBodyWarpId).bbox;
    const w = (maxX - minX) || 1;
    const h = (maxY - minY) || 1;
    canvasToInnermostX = (cx) => (cx - minX) / w;
    canvasToInnermostY = (cy) => (cy - minY) / h;
  }

  /** @type {import('./rigSpec.js').RigSpec} */
  const rigSpec = {
    parameters: project.parameters ?? [],
    parts: (project.nodes ?? [])
      .filter(n => n.type === 'group')
      .map(g => ({
        id: g.id,
        name: g.name,
        parentPartId: g.parent ?? null,
        isVisible: g.visible !== false,
        opacity: 1,
      })),
    warpDeformers,
    rotationDeformers,
    artMeshes,
    physicsRules: [],
    canvas: { w: canvasW, h: canvasH },
    canvasToInnermostX,
    canvasToInnermostY,
    innermostBodyWarpId,
    bodyWarpChain: null,  // Authored path doesn't synthesize; export-time concern.
    debug: { source: 'authored-cmo3' },
  };

  return {
    rigSpec,
    debug: {
      warpCount: warpDeformers.length,
      rotationCount: rotationDeformers.length,
      artMeshCount: artMeshes.length,
      innermostBodyWarpId,
      warpRestLifted: warpRest.size,
      rotationRestComputed: rotationRest.size,
    },
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Resolve a deformer's parent into a RigSpecParent.
 */
function resolveParent(deformer, deformerByGuid) {
  const parentRef = deformer.parentDeformerGuidRef;
  if (!parentRef) return { type: 'root', id: null };
  const parent = deformerByGuid.get(parentRef);
  if (!parent) return { type: 'root', id: null };
  return { type: parent.kind, id: parent.idStr };
}

/**
 * Reverse-engineer the rigSpec localFrame string from the parent type.
 * v3's RigSpec localFrame is a label that identifies what coordinate
 * system the warp's positions are in. For our purposes the chainEval
 * doesn't actually inspect this — keep it consistent with the parent.
 */
function parentLocalFrame(parent) {
  if (parent.type === 'root') return 'canvasPx';
  if (parent.type === 'warp') return 'parentWarpUV';
  return 'parentRotationPx';
}

/**
 * Walk a deformer's keyform grid + bindings to produce ordered keyforms.
 *
 * cmo3's KeyformGrid stores cells with multi-dimensional access keys; we
 * flatten them into v3's flat list with a `keyTuple` per cell.
 */
function buildKeyformsFromGrid({ deformer, grid, bindingByXsId }) {
  // Resolve bindings via the grid's _keyOnParameterList ordering. Each
  // grid cell's accessKey is a list of {bindingRef, keyIndex} entries,
  // one per binding. The order of bindings is consistent across cells —
  // pull from cell 0.
  const bindingOrder = [];
  if (grid && grid.entries.length > 0) {
    for (const entry of grid.entries[0].accessKey) {
      if (!entry.bindingRef) continue;
      bindingOrder.push(entry.bindingRef);
    }
  }
  /** @type {import('./rigSpec.js').KeyformBindingSpec[]} */
  const bindings = bindingOrder
    .map(ref => bindingByXsId.get(ref))
    .filter(b => b)
    .map(b => ({
      parameterId: b.paramId,
      keys: b.keys,
      interpolation: b.interpolation,
    }));

  // For each cmo3 keyform (in extraction order), find its grid cell to
  // produce keyTuple. cmo3 stores keyforms with the SAME order as grid
  // cells in cross-product order — so deformer.keyforms[i] matches
  // grid.entries[i].
  const keyforms = [];
  for (let i = 0; i < deformer.keyforms.length; i++) {
    const kf = deformer.keyforms[i];
    const entry = grid?.entries[i];
    let keyTuple = [];
    if (entry) {
      keyTuple = entry.accessKey.map((ak, idx) => {
        const ref = bindingOrder[idx];
        const b = ref ? bindingByXsId.get(ref) : null;
        return b?.keys[ak.keyIndex] ?? 0;
      });
    }
    keyforms.push({
      keyTuple,
      positions: kf.positions,
      angle: kf.angle,
      originX: kf.originX,
      originY: kf.originY,
      scale: kf.scale,
    });
  }
  return { bindings, keyforms };
}

/**
 * Detect the innermost body warp — the deepest warp on the "body chain"
 * that has multiple children (so it's a chain hub, not a leaf rigWarp).
 *
 * For shelby this is BodyXWarp (parent of NeckWarp + RigWarp_topwear +
 * RigWarp_legwear + Rotation_head + Rotation_root + ...). The "deepest
 * leaf" approach (DFS to longest chain) wrongly picks RigWarp_neck or
 * similar.
 */
function detectInnermostBodyWarp(warpDeformers, rotationDeformers) {
  /** @type {Map<string, number>} */
  const childCount = new Map();
  for (const w of warpDeformers) {
    if (w.parent.type !== 'warp' || !w.parent.id) continue;
    childCount.set(w.parent.id, (childCount.get(w.parent.id) ?? 0) + 1);
  }
  for (const r of rotationDeformers) {
    if (r.parent.type !== 'warp' || !r.parent.id) continue;
    childCount.set(r.parent.id, (childCount.get(r.parent.id) ?? 0) + 1);
  }
  // Find a root-parented warp, then chase the longest descendant chain
  // through warp parents only, picking the deepest one with ≥2 children
  // (= the chain hub).
  const byId = new Map(warpDeformers.map(w => [w.id, w]));
  /** @type {Map<string, string[]>} */
  const childrenById = new Map();
  for (const w of warpDeformers) {
    if (w.parent.type !== 'warp' || !w.parent.id) continue;
    if (!childrenById.has(w.parent.id)) childrenById.set(w.parent.id, []);
    childrenById.get(w.parent.id).push(w.id);
  }
  const roots = warpDeformers.filter(w => w.parent.type === 'root');
  if (roots.length === 0) return null;
  let best = null;
  let bestDepth = -1;
  function dfs(id, depth) {
    if ((childCount.get(id) ?? 0) >= 2 && depth > bestDepth) {
      bestDepth = depth;
      best = id;
    }
    const children = childrenById.get(id) ?? [];
    for (const c of children) dfs(c, depth + 1);
  }
  for (const r of roots) dfs(r.id, 0);
  return best ?? roots[0]?.id ?? null;
}

/**
 * Lift a warp's REST grid to canvas-px by walking up its parent chain.
 * Caches results in `warpRest` (passed in, may be partially populated by
 * a prior call). Handles parent=root, parent=warp, parent=rotation.
 *
 * For rotation parents: applies the rotation matrix at REST (R(restAngle)·in
 * + originAtCanvasPx). The rotation's canvas pivot must already be in
 * `rotationRest`; if not, the lift returns null.
 */
function liftWarpToCanvasAtRest(warp, allWarps, rotationRest, warpRest) {
  if (warpRest.has(warp.id)) return warpRest.get(warp.id).lifted;
  const byId = new Map(allWarps.map(w => [w.id, w]));
  const restKf = pickRestKeyform(warp);
  if (!restKf?.positions) return null;
  // Root parent: positions ARE canvas-px.
  if (warp.parent.type === 'root') return new Float64Array(restKf.positions);
  if (warp.parent.type === 'warp') {
    const parentSpec = byId.get(warp.parent.id);
    if (!parentSpec) return null;
    let parentLifted = warpRest.get(warp.parent.id)?.lifted;
    if (!parentLifted) {
      parentLifted = liftWarpToCanvasAtRest(parentSpec, allWarps, rotationRest, warpRest);
      if (!parentLifted) return null;
      // Cache the parent so siblings don't re-lift (bbox computed lazily by caller).
    }
    const inBuf = new Float32Array(restKf.positions);
    const outBuf = new Float32Array(restKf.positions.length);
    evalWarpKernelCubism(
      parentLifted, parentSpec.gridSize, parentSpec.isQuadTransform === true,
      inBuf, outBuf, restKf.positions.length / 2,
    );
    return Float64Array.from(outBuf);
  }
  if (warp.parent.type === 'rotation') {
    // Apply parent rotation at REST: out = R(restAngle)·in + canvasPivot.
    // The warp's positions are in pivot-relative-canvas-px from the parent
    // rotation's pivot. R at rest is identity (rest angle = 0), so out =
    // in + canvasPivot.
    const parentRest = rotationRest.get(warp.parent.id);
    if (!parentRest) return null;
    const out = new Float64Array(restKf.positions.length);
    const px = parentRest.pivot.x, py = parentRest.pivot.y;
    for (let i = 0; i < restKf.positions.length; i += 2) {
      out[i]     = restKf.positions[i]     + px;
      out[i + 1] = restKf.positions[i + 1] + py;
    }
    return out;
  }
  return null;
}

/**
 * Compute a rotation deformer's canvas-px pivot at REST.
 *
 * For parent=warp: rotation's restOrigin is in [0..1] of parent warp →
 * bilerp through parent's lifted grid → canvas-px.
 * For parent=rotation: pivot = parentPivot + restOrigin (offset).
 * For parent=root: rotation's restOrigin is canvas-px (unusual; treat as
 * canvas-fraction × canvas-dim as a fallback).
 */
function computeRotationCanvasPivotAtRest(rotation, warpRest, rotationRest) {
  const restKf = pickRestKeyform(rotation);
  if (!restKf) return null;
  const ox = restKf.originX ?? 0;
  const oy = restKf.originY ?? 0;
  if (rotation.parent.type === 'warp') {
    const parentRest = warpRest.get(rotation.parent.id);
    if (!parentRest) return null;
    const inBuf = new Float32Array([ox, oy]);
    const outBuf = new Float32Array(2);
    evalWarpKernelCubism(parentRest.lifted, parentRest.gridSize, parentRest.isQuad, inBuf, outBuf, 1);
    return { x: outBuf[0], y: outBuf[1] };
  }
  if (rotation.parent.type === 'rotation') {
    const parentRest = rotationRest.get(rotation.parent.id);
    if (!parentRest) return null;
    return { x: parentRest.pivot.x + ox, y: parentRest.pivot.y + oy };
  }
  // root parent: not sure how Cubism interprets; pass through as canvas-px
  // (which is what writers do for FaceRotation's parent=warp fallback).
  return { x: ox, y: oy };
}

/**
 * Pick the keyform closest to the rest pose (all params at 0). Falls back
 * to the median keyform if no zero-tuple cell exists.
 */
function pickRestKeyform(spec) {
  if (!Array.isArray(spec.keyforms) || spec.keyforms.length === 0) return null;
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < spec.keyforms.length; i++) {
    const tuple = spec.keyforms[i].keyTuple ?? [];
    let dist = 0;
    for (const v of tuple) dist += Math.abs(v ?? 0);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return spec.keyforms[bestIdx];
}
