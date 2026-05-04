/**
 * BFA-006 Phase 2 — derived `RigSpec` selector over `project.nodes`.
 *
 * Today's `useRigSpecStore.buildRigSpec` runs `generateCmo3` in
 * `rigOnly` mode end-to-end (or `buildRigSpecFromCmo3` for projects
 * loaded from cmo3) to produce a `RigSpec`. After Phase 1, warp
 * deformers persist as `type:'deformer', deformerKind:'warp'` entries
 * in `project.nodes`. This selector reads those nodes and produces the
 * same `RigSpec` shape `chainEval` expects — synchronously, with no
 * `await`.
 *
 * **Phase 2 scope (this file).** Reads what's already in `project.nodes`
 * and `project.parameters` / `project.canvas`:
 *   - `parameters`: copied verbatim
 *   - `parts`: built from `project.nodes.filter(type==='group')` (same
 *     mapping `buildRigSpecFromCmo3` uses, mirrors cmo3's CPartSource
 *     hierarchy)
 *   - `warpDeformers`: built from `type:'deformer', deformerKind:'warp'`
 *     nodes — parent flat ids resolved back to RigSpec `{type, id}`
 *     pairs by looking up the parent node
 *   - `physicsRules`: `resolvePhysicsRules(project)` (already a derived
 *     selector — no work)
 *   - `canvas`: `{w: project.canvas.width, h: project.canvas.height}`
 *   - `canvasToInnermostX/Y`, `innermostBodyWarpId`: derived from the
 *     deepest body-warp node's `baseGrid` bbox
 *
 * **Phase 2 NOT YET COVERED** (Phase 3 territory):
 *   - `rotationDeformers: []`  — rotation deformers aren't persisted in
 *     `project.nodes` yet; Phase 3's auto-rig dual-write captures them.
 *   - `artMeshes: []`  — derivation requires lifting the parent warp's
 *     rest grid to canvas-px to project mesh verts into the parent
 *     deformer's local frame; Phase 3 ships this alongside rotation
 *     node writes (the lifted-grid pass needs both warps + rotations
 *     to be present).
 *
 * **Identity-stable memoization.** `useRigSpecStore` consumers call
 * this once per mutation cycle; we cache the result keyed on `project`
 * identity (`project.nodes` + `project.parameters` + `project.canvas`
 * are structurally shared by Zustand/immer, so a non-mutating read
 * preserves identity and the cache hits). A tiny `WeakMap` survives
 * across re-renders with no manual invalidation.
 *
 * @module io/live2d/rig/selectRigSpec
 */

import { resolvePhysicsRules } from './physicsConfig.js';
import { evalWarpKernelCubism } from '../runtime/evaluator/cubismWarpEval.js';

/** Reusable frozen empty arrays so the selector returns the same
 * objects across calls when a section has no data. Lets shallow-equal
 * subscribers (chainEval's `buildDeformerIndex`) skip rebuilds. */
const EMPTY_PARTS = Object.freeze([]);
const EMPTY_DEFORMERS = Object.freeze([]);
const EMPTY_ARTMESHES = Object.freeze([]);
const EMPTY_PHYSICS = Object.freeze([]);

/** WeakMap<project, RigSpec> — memoization keyed on project identity. */
const _cache = new WeakMap();

/**
 * Derive a `RigSpec` from a project synchronously. Pure function; no
 * external state read other than what's on `project`.
 *
 * @param {object} project
 * @returns {import('./rigSpec.js').RigSpec}
 */
export function selectRigSpec(project) {
  if (!project || typeof project !== 'object') return _emptyRigSpec();
  const cached = _cache.get(project);
  if (cached) return cached;
  const spec = _buildRigSpec(project);
  _cache.set(project, spec);
  return spec;
}

/**
 * Imperative form for non-React callers (tests, services, rAF ticks).
 * Same memoization as the hook-friendly `selectRigSpec`.
 *
 * @param {object} project
 * @returns {import('./rigSpec.js').RigSpec}
 */
export function getRigSpec(project) {
  return selectRigSpec(project);
}

function _emptyRigSpec() {
  return {
    parameters: EMPTY_DEFORMERS,
    parts: EMPTY_PARTS,
    warpDeformers: EMPTY_DEFORMERS,
    rotationDeformers: EMPTY_DEFORMERS,
    artMeshes: EMPTY_ARTMESHES,
    physicsRules: EMPTY_PHYSICS,
    canvas: { w: 800, h: 600 },
    canvasToInnermostX: null,
    canvasToInnermostY: null,
    innermostBodyWarpId: null,
    debug: { source: 'selectRigSpec', empty: true },
  };
}

function _buildRigSpec(project) {
  const nodes = Array.isArray(project.nodes) ? project.nodes : [];

  // Index nodes by id once so parent lookups are O(1).
  /** @type {Map<string, object>} */
  const nodeById = new Map();
  for (const n of nodes) {
    if (n && typeof n.id === 'string') nodeById.set(n.id, n);
  }

  const warpNodes = nodes.filter(
    (n) => n?.type === 'deformer' && n.deformerKind === 'warp'
  );
  const rotationNodes = nodes.filter(
    (n) => n?.type === 'deformer' && n.deformerKind === 'rotation'
  );

  // Topo-sort by parent: parents before children. Same Kahn-style walk
  // `buildRigSpecFromCmo3` uses, except over `node.parent` ids (Phase
  // 1's flattening) instead of cmo3 GUID refs. Topo order is required
  // by the rest-lift pass below — each warp's rest grid is computed
  // by composing its parent's lifted grid, so parents must be done
  // first.
  const allDeformerNodes = [...warpNodes, ...rotationNodes];
  const ordered = _topoSortDeformerNodes(allDeformerNodes);
  const orderedWarpNodes = ordered.filter((n) => n.deformerKind === 'warp');
  const orderedRotationNodes = ordered.filter((n) => n.deformerKind === 'rotation');

  const warpDeformers = orderedWarpNodes.map((n) => _warpNodeToSpec(n, nodeById));
  const rotationDeformers = orderedRotationNodes.map((n) => _rotationNodeToSpec(n, nodeById));

  const parts = nodes
    .filter((n) => n?.type === 'group')
    .map((g) => ({
      id: g.id,
      name: g.name ?? g.id,
      parentPartId: g.parent ?? null,
      isVisible: g.visible !== false,
      opacity: typeof g.opacity === 'number' ? g.opacity : 1,
    }));

  // Phase 3 — lift every warp's rest grid to canvas-px (parents
  // first; topo order above guarantees this) and compute every
  // rotation's canvas-px pivot at rest. Used by:
  //   - `_deriveInnermostBodyClosures` for canvas→innermost
  //     normaliser closures (replaces Phase 2's baseGrid-only
  //     fallback that only worked for the outermost root-parented
  //     warp).
  //   - `_buildArtMeshes` to project mesh canvas-px verts into
  //     parent-deformer-local frame for the artMesh's single rest
  //     keyform.
  const warpRestById = new Map();
  const rotationRestById = new Map();
  _computeRestState({
    orderedWarps: warpDeformers,
    orderedRotations: rotationDeformers,
    warpDeformers,
    warpRestById,
    rotationRestById,
  });

  // Innermost body warp + canvas→innermost normalisers, derived from
  // the deepest warp node in the BodyZ→BodyY→Breath→BodyX chain.
  const { innermostBodyWarpId, canvasToInnermostX, canvasToInnermostY } =
    _deriveInnermostBodyClosures(orderedWarpNodes, allDeformerNodes, warpRestById);

  // Build artMeshes from project parts. Each part with mesh data
  // becomes an ArtMeshSpec carrying a single rest keyform with verts
  // in parent-deformer-local frame. Phase 3+: parent comes from
  // `partNode.rigParent` (Phase 1 set it for parts with rigWarps);
  // fallback to `innermostBodyWarpId` for body-driven parts.
  const artMeshes = _buildArtMeshes({
    project,
    nodeById,
    warpRestById,
    rotationRestById,
    innermostBodyWarpId,
  });

  const w = project.canvas?.width ?? 800;
  const h = project.canvas?.height ?? 600;

  return {
    parameters: project.parameters ?? EMPTY_DEFORMERS,
    parts,
    warpDeformers,
    rotationDeformers,
    artMeshes,
    physicsRules: resolvePhysicsRules(project) ?? EMPTY_PHYSICS,
    canvas: { w, h },
    canvasToInnermostX,
    canvasToInnermostY,
    innermostBodyWarpId,
    debug: { source: 'selectRigSpec' },
  };
}

/**
 * Kahn topo sort over `node.parent` (the project-tree parent ids
 * Phase 1 wrote). Parents emit before children. Cycles fall through
 * to the tail (best-effort; a malformed rig surfaces as identity in
 * `chainEval` rather than an exception).
 *
 * @param {Array<object>} nodes
 * @returns {Array<object>}
 */
function _topoSortDeformerNodes(nodes) {
  const idSet = new Set(nodes.map((n) => n.id));
  const remaining = new Set(nodes);
  const out = [];
  const placed = new Set();
  let progress = true;
  while (progress && remaining.size > 0) {
    progress = false;
    for (const n of [...remaining]) {
      // parentReady when:
      //   - parent is null/undefined (root)
      //   - parent points outside the deformer set (= a part / group / unknown)
      //   - parent points to an already-placed deformer
      const p = n.parent;
      const parentReady = !p || !idSet.has(p) || placed.has(p);
      if (parentReady) {
        out.push(n);
        placed.add(n.id);
        remaining.delete(n);
        progress = true;
      }
    }
  }
  for (const n of remaining) out.push(n);
  return out;
}

/**
 * For each warp in topo order, lift its rest grid to canvas-px by
 * walking up the parent chain. For each rotation in topo order,
 * compute its canvas-px pivot at rest. Output goes into the maps
 * passed in. Mirrors `buildRigSpecFromCmo3.computeRestState` —
 * verbatim algorithm, restated here so `selectRigSpec` doesn't take
 * a runtime dependency on the cmo3-only build path.
 */
function _computeRestState({
  orderedWarps,
  orderedRotations,
  warpDeformers,
  warpRestById,
  rotationRestById,
}) {
  // Combined topo order: walk warps + rotations together so a warp
  // with a rotation parent (and vice versa) sees its dependency
  // resolved. The arrays are individually topo-sorted; merging by
  // position would interleave wrong. Build an id→spec lookup and
  // walk both lists in one pass keyed off the topo order.
  const warpById = new Map(orderedWarps.map((w) => [w.id, w]));
  const rotationById = new Map(orderedRotations.map((r) => [r.id, r]));
  // Re-derive a unified topo order over the combined set.
  /** @type {Array<{kind:'warp'|'rotation', id:string}>} */
  const combined = [...orderedWarps.map((w) => ({ kind: 'warp', id: w.id })),
                    ...orderedRotations.map((r) => ({ kind: 'rotation', id: r.id }))];
  // Stable: warps first, then rotations — but we need TRUE topo. Walk
  // both arrays interleaved by parent-readiness.
  const idSet = new Set(combined.map((c) => c.id));
  const placed = new Set();
  /** @type {Set<{kind:'warp'|'rotation', id:string}>} */
  const remaining = new Set(combined);
  const trueOrdered = [];
  let progress = true;
  while (progress && remaining.size > 0) {
    progress = false;
    for (const c of [...remaining]) {
      const spec = c.kind === 'warp' ? warpById.get(c.id) : rotationById.get(c.id);
      const p = spec?.parent;
      const parentReady = !p || p.type === 'root' || !idSet.has(p.id) || placed.has(p.id);
      if (parentReady) {
        trueOrdered.push(c);
        placed.add(c.id);
        remaining.delete(c);
        progress = true;
      }
    }
  }
  for (const c of remaining) trueOrdered.push(c);

  for (const c of trueOrdered) {
    if (c.kind === 'warp') {
      const w = warpById.get(c.id);
      if (!w) continue;
      const lifted = _liftWarpToCanvasAtRest(w, warpDeformers, rotationRestById, warpRestById);
      if (!lifted) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < lifted.length; i += 2) {
        const x = lifted[i], y = lifted[i + 1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      warpRestById.set(w.id, {
        kind: 'warp',
        lifted,
        bbox: { minX, minY, maxX, maxY },
        gridSize: w.gridSize,
        isQuad: w.isQuadTransform === true,
      });
    } else if (c.kind === 'rotation') {
      const r = rotationById.get(c.id);
      if (!r) continue;
      const pivot = _computeRotationCanvasPivotAtRest(r, warpRestById, rotationRestById);
      if (pivot) rotationRestById.set(r.id, { kind: 'rotation', pivot });
    }
  }
}

function _pickRestKeyform(spec) {
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

function _liftWarpToCanvasAtRest(warp, allWarps, rotationRest, warpRest) {
  if (warpRest.has(warp.id)) return warpRest.get(warp.id).lifted;
  const byId = new Map(allWarps.map((w) => [w.id, w]));
  const restKf = _pickRestKeyform(warp);
  if (!restKf?.positions) return null;
  // Root parent: positions ARE canvas-px.
  if (warp.parent.type === 'root') return new Float64Array(restKf.positions);
  if (warp.parent.type === 'warp') {
    const parentSpec = byId.get(warp.parent.id);
    if (!parentSpec) return null;
    let parentLifted = warpRest.get(warp.parent.id)?.lifted;
    if (!parentLifted) {
      parentLifted = _liftWarpToCanvasAtRest(parentSpec, allWarps, rotationRest, warpRest);
      if (!parentLifted) return null;
    }
    const inBuf = new Float32Array(restKf.positions);
    const outBuf = new Float32Array(restKf.positions.length);
    evalWarpKernelCubism(
      parentLifted,
      parentSpec.gridSize,
      parentSpec.isQuadTransform === true,
      inBuf,
      outBuf,
      restKf.positions.length / 2,
    );
    return Float64Array.from(outBuf);
  }
  if (warp.parent.type === 'rotation') {
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
  // Parent is a part / group — treat as canvas-px (same as root).
  return new Float64Array(restKf.positions);
}

function _computeRotationCanvasPivotAtRest(rotation, warpRest, rotationRest) {
  const restKf = _pickRestKeyform(rotation);
  if (!restKf) return null;
  const ox = restKf.originX ?? 0;
  const oy = restKf.originY ?? 0;
  if (rotation.parent.type === 'warp') {
    const parentRest = warpRest.get(rotation.parent.id);
    if (!parentRest) return null;
    const inBuf = new Float32Array([ox, oy]);
    const outBuf = new Float32Array(2);
    evalWarpKernelCubism(
      parentRest.lifted,
      parentRest.gridSize,
      parentRest.isQuad,
      inBuf,
      outBuf,
      1,
    );
    return { x: outBuf[0], y: outBuf[1] };
  }
  if (rotation.parent.type === 'rotation') {
    const parentRest = rotationRest.get(rotation.parent.id);
    if (!parentRest) return null;
    return { x: parentRest.pivot.x + ox, y: parentRest.pivot.y + oy };
  }
  // Root or part parent — pass canvas-px through.
  return { x: ox, y: oy };
}

/**
 * For each part with mesh data, build an `ArtMeshSpec`. Single rest
 * keyform; vertex positions in parent-deformer-local frame. Parent
 * resolution:
 *   - `partNode.rigParent` set (Phase 1 wrote it for rigWarps-covered
 *     parts) → use it as the deformer parent.
 *   - Unset → fall back to `innermostBodyWarpId` (matches today's
 *     heuristic-path semantic where uncovered parts ride the body
 *     chain).
 *   - Innermost body warp also unset → root-parent (canvas-px verts
 *     pass through).
 */
function _buildArtMeshes({ project, nodeById, warpRestById, rotationRestById, innermostBodyWarpId }) {
  const parts = (project.nodes ?? []).filter((n) => n?.type === 'part' && n.mesh && Array.isArray(n.mesh.vertices) && n.mesh.vertices.length > 0);
  if (parts.length === 0) return EMPTY_ARTMESHES;
  const out = [];
  for (const part of parts) {
    const verts = part.mesh.vertices;
    const tris = part.mesh.triangles ?? [];
    const uvs = part.mesh.uvs ?? [];

    let parentRef = { type: 'root', id: null };
    const targetParentId =
      part.rigParent && nodeById.has(part.rigParent) ? part.rigParent
      : innermostBodyWarpId && nodeById.has(innermostBodyWarpId) ? innermostBodyWarpId
      : null;
    if (targetParentId) {
      const parentNode = nodeById.get(targetParentId);
      if (parentNode?.type === 'deformer') {
        parentRef = parentNode.deformerKind === 'rotation'
          ? { type: 'rotation', id: targetParentId }
          : { type: 'warp', id: targetParentId };
      }
    }

    // Frame-convert canvas-px verts → parent-deformer-local. Same
    // rules as `buildRigSpecFromCmo3`'s artMesh pass:
    //   parent=warp     → normalised 0..1 of warp's lifted-rest bbox
    //   parent=rotation → canvas-px relative to rotation pivot
    //   parent=root     → canvas-px verbatim
    const flatVerts = _toFlatNumberArray(verts);
    const localVerts = new Float32Array(flatVerts.length);
    if (parentRef.type === 'warp') {
      const restState = warpRestById.get(parentRef.id);
      if (restState) {
        const { minX, minY, maxX, maxY } = restState.bbox;
        const dw = (maxX - minX) || 1;
        const dh = (maxY - minY) || 1;
        for (let v = 0; v < flatVerts.length; v += 2) {
          localVerts[v]     = (flatVerts[v]     - minX) / dw;
          localVerts[v + 1] = (flatVerts[v + 1] - minY) / dh;
        }
      } else {
        for (let v = 0; v < flatVerts.length; v++) localVerts[v] = flatVerts[v];
      }
    } else if (parentRef.type === 'rotation') {
      const restState = rotationRestById.get(parentRef.id);
      if (restState) {
        const px = restState.pivot.x, py = restState.pivot.y;
        for (let v = 0; v < flatVerts.length; v += 2) {
          localVerts[v]     = flatVerts[v]     - px;
          localVerts[v + 1] = flatVerts[v + 1] - py;
        }
      } else {
        for (let v = 0; v < flatVerts.length; v++) localVerts[v] = flatVerts[v];
      }
    } else {
      for (let v = 0; v < flatVerts.length; v++) localVerts[v] = flatVerts[v];
    }

    out.push({
      id: part.id,
      name: part.name ?? part.id,
      parent: parentRef,
      verticesCanvas: new Float32Array(flatVerts),
      triangles: _toUint16Array(tris),
      uvs: _toFloat32Array(uvs),
      variantSuffix: part.variantSuffix ?? null,
      textureId: part.id ?? null,
      bindings: [],
      keyforms: [{
        keyTuple: [],
        vertexPositions: localVerts,
        opacity: 1,
        drawOrder: typeof part.draw_order === 'number' ? part.draw_order : 0,
      }],
      maskMeshIds: Array.isArray(part.maskMeshIds) ? part.maskMeshIds.slice() : [],
      isVisible: part.visible !== false,
      drawOrder: typeof part.draw_order === 'number' ? part.draw_order : 0,
    });
  }
  return out;
}

function _toFlatNumberArray(verts) {
  // Mesh vertices are stored as either `[{x, y}, ...]` or flat
  // `[x0, y0, x1, y1, ...]`. Project's `node.mesh.vertices` uses the
  // flat form historically — but defensive against either.
  if (!Array.isArray(verts) && !ArrayBuffer.isView(verts)) return [];
  if (verts.length > 0 && typeof verts[0] === 'object' && verts[0] !== null) {
    const flat = new Array(verts.length * 2);
    for (let i = 0; i < verts.length; i++) {
      flat[i * 2] = verts[i].x ?? 0;
      flat[i * 2 + 1] = verts[i].y ?? 0;
    }
    return flat;
  }
  return Array.from(verts);
}

function _toFloat32Array(arr) {
  if (arr instanceof Float32Array) return arr;
  if (Array.isArray(arr) || ArrayBuffer.isView(arr)) return new Float32Array(arr);
  return new Float32Array(0);
}

function _toUint16Array(arr) {
  if (arr instanceof Uint16Array) return arr;
  if (Array.isArray(arr) || ArrayBuffer.isView(arr)) return new Uint16Array(arr);
  return new Uint16Array(0);
}

/**
 * Convert a `type:'deformer', deformerKind:'warp'` node back to a
 * `WarpDeformerSpec`. Re-inflates the flat `parent: nodeId|null` into
 * `{type, id}` by looking up the parent node's discriminator.
 *
 * Float64Array typed arrays are reconstructed from the stored plain
 * arrays — `chainEval`'s warp kernel expects typed buffers.
 */
function _warpNodeToSpec(node, nodeById) {
  return {
    id: node.id,
    name: node.name ?? node.id,
    parent: _resolveParentRef(node.parent, nodeById),
    gridSize: {
      rows: node.gridSize?.rows ?? 5,
      cols: node.gridSize?.cols ?? 5,
    },
    baseGrid: _toFloat64(node.baseGrid),
    localFrame: node.localFrame ?? 'canvas-px',
    bindings: (node.bindings ?? []).map((b) => ({
      parameterId: b.parameterId,
      keys: Array.isArray(b.keys) ? b.keys.slice() : [],
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (node.keyforms ?? []).map((k) => ({
      keyTuple: Array.isArray(k.keyTuple) ? k.keyTuple.slice() : [],
      positions: _toFloat64(k.positions),
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    })),
    isVisible: node.visible !== false,
    isLocked: node.isLocked === true,
    isQuadTransform: node.isQuadTransform === true,
    // Optional per-mesh rigWarp metadata — preserved for cmo3writer's
    // CDeformerSource emission (which keys per-mesh warps by targetPartId).
    targetPartId: node.targetPartId,
    canvasBbox: node.canvasBbox,
  };
}

/**
 * Convert a `type:'deformer', deformerKind:'rotation'` node back to a
 * `RotationDeformerSpec`. Phase 2 returns these as-is (no nodes exist
 * yet); included so Phase 3's Init Rig writes can be consumed without
 * a follow-up plumbing change.
 */
function _rotationNodeToSpec(node, nodeById) {
  return {
    id: node.id,
    name: node.name ?? node.id,
    parent: _resolveParentRef(node.parent, nodeById),
    bindings: (node.bindings ?? []).map((b) => ({
      parameterId: b.parameterId,
      keys: Array.isArray(b.keys) ? b.keys.slice() : [],
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (node.keyforms ?? []).map((k) => ({
      keyTuple: Array.isArray(k.keyTuple) ? k.keyTuple.slice() : [],
      angle: k.angle ?? 0,
      originX: k.originX ?? 0,
      originY: k.originY ?? 0,
      scale: typeof k.scale === 'number' ? k.scale : 1,
      reflectX: k.reflectX === true,
      reflectY: k.reflectY === true,
      opacity: typeof k.opacity === 'number' ? k.opacity : 1,
    })),
    baseAngle: typeof node.baseAngle === 'number' ? node.baseAngle : 0,
    handleLengthOnCanvas:
      typeof node.handleLengthOnCanvas === 'number' ? node.handleLengthOnCanvas : 200,
    circleRadiusOnCanvas:
      typeof node.circleRadiusOnCanvas === 'number' ? node.circleRadiusOnCanvas : 100,
    isVisible: node.visible !== false,
    isLocked: node.isLocked === true,
    useBoneUiTestImpl: node.useBoneUiTestImpl !== false,
  };
}

/**
 * Given a flat `parent: string|null` from a project node, look up the
 * referenced node and translate to the RigSpec's `{type, id}` shape.
 *
 *   null                      → {type:'root',     id:null}
 *   id of warp deformer       → {type:'warp',     id}
 *   id of rotation deformer   → {type:'rotation', id}
 *   id of part                → {type:'part',     id}
 *   id of group (= bone)      → {type:'part',     id}    (Cubism encodes bones as parts)
 *   dangling id               → {type:'root',     id:null}
 *     ← e.g. a warp pointing at 'FaceRotation' before Phase 3 has
 *     written rotation deformer nodes. Defensive: chainEval treats
 *     unresolved parents as root, identical to today's behaviour.
 */
function _resolveParentRef(parentId, nodeById) {
  if (!parentId) return { type: 'root', id: null };
  const parent = nodeById.get(parentId);
  if (!parent) return { type: 'root', id: null };
  if (parent.type === 'deformer') {
    if (parent.deformerKind === 'rotation') return { type: 'rotation', id: parentId };
    return { type: 'warp', id: parentId };
  }
  if (parent.type === 'part' || parent.type === 'group') {
    return { type: 'part', id: parentId };
  }
  return { type: 'root', id: null };
}

/**
 * Pick the deepest warp in the BodyZ → BodyY → Breath → BodyX chain
 * (when present) and derive `canvas → innermost-warp 0..1` normaliser
 * closures from its baseGrid bbox.
 *
 * Mirrors `buildRigSpecFromCmo3.detectInnermostBodyWarp` — the
 * "deepest warp parent that has ≥2 children" heuristic — over the
 * Phase-1 warp nodes. Falls back to the deepest Body* node by chain
 * walk if no chain hub is present.
 */
function _deriveInnermostBodyClosures(warpNodes, allDeformerNodes, warpRestById) {
  if (warpNodes.length === 0) {
    return { innermostBodyWarpId: null, canvasToInnermostX: null, canvasToInnermostY: null };
  }
  // Build child count per warp id (count both warp + rotation children
  // — same as buildRigSpecFromCmo3).
  /** @type {Map<string, number>} */
  const childCount = new Map();
  for (const d of allDeformerNodes) {
    if (d.parent) childCount.set(d.parent, (childCount.get(d.parent) ?? 0) + 1);
  }
  const byId = new Map(warpNodes.map((w) => [w.id, w]));
  /** @type {Map<string, string[]>} */
  const childrenById = new Map();
  for (const w of warpNodes) {
    if (!w.parent || !byId.has(w.parent)) continue;
    if (!childrenById.has(w.parent)) childrenById.set(w.parent, []);
    childrenById.get(w.parent).push(w.id);
  }
  const roots = warpNodes.filter((w) => !w.parent || !byId.has(w.parent));

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

  // Fallback: pick the deepest BodyXWarp / BodyYWarp / BodyZWarp /
  // BreathWarp by chain depth, even without ≥2 children. This handles
  // the Phase-1 sidetable case where the chain is a flat linear path.
  if (!best) {
    let depthBest = -1;
    function depthDfs(id, depth) {
      const w = byId.get(id);
      if (!w) return;
      const isBodyName = ['BodyWarpZ', 'BodyWarpY', 'BreathWarp', 'BodyXWarp'].includes(id);
      if (isBodyName && depth > depthBest) {
        depthBest = depth;
        best = id;
      }
      const children = childrenById.get(id) ?? [];
      for (const c of children) depthDfs(c, depth + 1);
    }
    for (const r of roots) depthDfs(r.id, 0);
  }

  if (!best) {
    return { innermostBodyWarpId: null, canvasToInnermostX: null, canvasToInnermostY: null };
  }

  // Phase 3 — read the lifted canvas-px bbox from the rest-state
  // pass instead of falling back to the warp's `localFrame ===
  // 'canvas-px'` shortcut. Works for chained body warps too because
  // the rest pass lifted the entire chain through bilinear FFD.
  const restState = warpRestById.get(best);
  if (!restState) {
    return { innermostBodyWarpId: best, canvasToInnermostX: null, canvasToInnermostY: null };
  }
  const { minX, minY, maxX, maxY } = restState.bbox;
  const dw = (maxX - minX) || 1;
  const dh = (maxY - minY) || 1;
  return {
    innermostBodyWarpId: best,
    canvasToInnermostX: (cx) => (cx - minX) / dw,
    canvasToInnermostY: (cy) => (cy - minY) / dh,
  };
}

function _toFloat64(arr) {
  if (arr instanceof Float64Array) return arr;
  if (Array.isArray(arr)) return new Float64Array(arr);
  return new Float64Array(0);
}
