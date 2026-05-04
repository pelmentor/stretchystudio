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

  const warpDeformers = warpNodes.map((n) => _warpNodeToSpec(n, nodeById));
  const rotationDeformers = rotationNodes.map((n) => _rotationNodeToSpec(n, nodeById));

  const parts = nodes
    .filter((n) => n?.type === 'group')
    .map((g) => ({
      id: g.id,
      name: g.name ?? g.id,
      parentPartId: g.parent ?? null,
      isVisible: g.visible !== false,
      opacity: typeof g.opacity === 'number' ? g.opacity : 1,
    }));

  // Innermost body warp + canvas→innermost normalisers, derived from
  // the deepest warp node in the BodyZ→BodyY→Breath→BodyX chain.
  const { innermostBodyWarpId, canvasToInnermostX, canvasToInnermostY } =
    _deriveInnermostBodyClosures(warpNodes, project);

  const w = project.canvas?.width ?? 800;
  const h = project.canvas?.height ?? 600;

  return {
    parameters: project.parameters ?? EMPTY_DEFORMERS,
    parts,
    warpDeformers,
    rotationDeformers,
    artMeshes: EMPTY_ARTMESHES,                  // Phase 3
    physicsRules: resolvePhysicsRules(project) ?? EMPTY_PHYSICS,
    canvas: { w, h },
    canvasToInnermostX,
    canvasToInnermostY,
    innermostBodyWarpId,
    debug: { source: 'selectRigSpec' },
  };
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
function _deriveInnermostBodyClosures(warpNodes, project) {
  if (warpNodes.length === 0) {
    return { innermostBodyWarpId: null, canvasToInnermostX: null, canvasToInnermostY: null };
  }
  // Build child count per warp id (count both warp + rotation children
  // — same as buildRigSpecFromCmo3).
  const allDeformers = (project.nodes ?? []).filter((n) => n?.type === 'deformer');
  /** @type {Map<string, number>} */
  const childCount = new Map();
  for (const d of allDeformers) {
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
      const isBodyName = ['BodyZWarp', 'BodyYWarp', 'BreathWarp', 'BodyXWarp'].includes(id);
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

  // Compute canvas-px bbox of the innermost warp's baseGrid. Phase 1
  // stores baseGrid in the warp's localFrame, which for the innermost
  // body warp is `'normalized-0to1'` of its parent. To get a canvas-px
  // bbox we'd need to lift the chain — that's Phase 3 territory.
  //
  // For Phase 2 we approximate: when the innermost warp's localFrame
  // is `'canvas-px'` (the outermost root-parented body warp), the
  // bbox is directly usable. Otherwise return null closures and let
  // chainEval's `_warpSlopeX/Y` fallback kick in (preserves today's
  // behaviour for chained warps).
  const warp = byId.get(best);
  if (warp.localFrame !== 'canvas-px') {
    return { innermostBodyWarpId: best, canvasToInnermostX: null, canvasToInnermostY: null };
  }
  const grid = warp.baseGrid;
  if (!Array.isArray(grid) || grid.length < 4) {
    return { innermostBodyWarpId: best, canvasToInnermostX: null, canvasToInnermostY: null };
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < grid.length; i += 2) {
    const x = grid[i], y = grid[i + 1];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
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
