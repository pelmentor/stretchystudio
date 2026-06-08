/**
 * BFA-006 Phase 2 — derived `RigSpec` selector over `project.nodes`.
 *
 * Today's `useRigSpecStore.buildRigSpec` runs `generateCmo3` in
 * `rigOnly` mode end-to-end (or `buildRigSpecFromCmo3` for projects
 * loaded from cmo3) to produce a `RigSpec`. After Phase 1, warp
 * deformers persist as `type:'deformer', deformerKind:'warp'` entries
 * in `project.nodes`. This selector reads those nodes and produces the
 * same `RigSpec` shape the depgraph evaluator
 * (`evalProjectFrameViaDepgraph`) expects — synchronously, with no
 * `await`. (Pre-`146b716` the consumer was the now-retired `chainEval`
 * engine; see `[[chainEval-retirement-2026-05-26]]`.)
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
 *   - `physicsRules`: `gatherPhysicsRules(project)` — gathers per-node
 *     physicsModifier entries (v50, 2026-06-08) and re-merges by ruleId
 *     into the legacy resolved-rule shape consumed by runtime/exporter
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

import { gatherPhysicsRules } from './physicsConfig.js';
import { evalWarpKernelCubism } from '../runtime/evaluator/cubismWarpEval.js';
import { getMesh } from '../../../store/objectDataAccess.js';
import {
  isWarpLatticeNode,
  isRotationDeformerNode,
  isChainDeformerNode,
  findInnermostBodyWarpId,
} from '../../../store/warpLatticeAccess.js';
import { synthesizeDeformerNodesForExport } from './synthesizeDeformerNodesForExport.js';
import {
  MODIFIER_MODE_REALTIME,
  MODIFIER_MODE_RENDER,
} from '../../../store/migrations/v21_modifier_mode_flags.js';
import {
  coerceNumberArray,
  coerceFloat64Array,
  coerceFloat32Array,
  coerceUint16Array,
} from '../../../lib/numberArrayCoerce.js';
import { logger } from '../../../lib/logger.js';

/**
 * Once-per-process Set of `<partId>|<reason>` keys for diagnostic
 * dedup. Pre-rig fallback's silent-passthrough branches log once
 * per (part, reason) so an orphan body-warp (missing rest state)
 * gets surfaced exactly once per session — the depgraph re-runs every
 * frame and an unbounded stream would flood the Logs panel. Lives
 * at module scope so the dedup persists across re-renders.
 */
const _selectRigSpecWarnedKeys = new Set();
function _warnOncePerPart(key, fn) {
  if (_selectRigSpecWarnedKeys.has(key)) return;
  _selectRigSpecWarnedKeys.add(key);
  fn();
}

/** Live-render eval context — Blender's MODE_REALTIME for the
 *  viewport / Live Preview tick. The `selectRigSpec` selector feeds
 *  the depgraph evaluator for the live render path; export bakes go
 *  through `generateCmo3` instead and don't read this constant. */
const LIVE_RENDER_REQUIRED_MODE = MODIFIER_MODE_REALTIME;

/** Reusable frozen empty arrays so the selector returns the same
 * objects across calls when a section has no data. Lets shallow-equal
 * subscribers skip rebuilds. */
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

  // BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.B — read deformers via the
  // synth that walks `Object.modifiers[]` (with `modifier.data` from
  // Phase 3.A's v28 migration) rather than filtering `project.nodes`
  // directly. Pre-flight confirmed synth ≡ node-filter on the user's
  // Shelby (27/27 deformers, 0 field diffs, 0 binding/keyform diffs).
  // `includeOrphans: true` (default) preserves orphan deformer nodes
  // until Phase 3.C deletes them from `project.nodes` entirely.
  // `suppressFlare`: selectRigSpec is the per-frame RUNTIME rigSpec source
  // (the viewport depgraph eval calls it every tick), not just the export
  // path. The orphan-fallback "will disappear after Phase 3.C" warning is an
  // export-transition diagnostic; firing it here spams the Logs panel dozens
  // of times a second during any interaction (each eval re-runs synth with a
  // fresh immer project ref, defeating the once-per-project dedup). The
  // orphan-fallback data itself is still emitted — only the noisy flare is
  // muted on the runtime path.
  const synthesizedDeformers = synthesizeDeformerNodesForExport(project, { suppressFlare: true });
  // Mirror synth nodes into the index so `_resolveParentRef` lookups
  // reach them (the lookup is by id, not by reference).
  for (const n of synthesizedDeformers) {
    if (n && typeof n.id === 'string') nodeById.set(n.id, n);
  }
  const warpNodes = synthesizedDeformers.filter(
    (n) => n?.deformerKind === 'warp'
  );
  const rotationNodes = synthesizedDeformers.filter(
    (n) => n?.deformerKind === 'rotation'
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
  // in parent-deformer-local frame. Post-M4 (RULE-№4, 2026-05-23):
  // the runtime-cache fast path resolves parent from `modifiers[0]`
  // (M3.1); the pre-rig fallback for projects without `mesh.runtime`
  // populated derives the parent from `innermostBodyWarpId` (M4 —
  // the `partNode.rigParent` source was retired with the field).
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
    physicsRules: gatherPhysicsRules(project) ?? EMPTY_PHYSICS,
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
 * the depgraph evaluator rather than an exception).
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
 * resolution priority (M4 RULE-№4, 2026-05-23):
 *   - Runtime-cache fast path (the part has `mesh.runtime`): parent
 *     derives from `modifiers[0]` with lattice → 'warp' normalisation
 *     (M3.1). Armature-only stacks fall through to root.
 *   - Pre-rig fallback (no `mesh.runtime`): fall back to
 *     `innermostBodyWarpId` (matches the body-rig default for parts
 *     that haven't been Init-Rigged yet).
 *   - Innermost body warp also unset → root-parent (canvas-px verts
 *     pass through).
 */
function _buildArtMeshes({ project, nodeById, warpRestById, rotationRestById, innermostBodyWarpId }) {
  const parts = (project.nodes ?? []).filter((n) => {
    const m = getMesh(n, project);
    return !!m && Array.isArray(m.vertices) && m.vertices.length > 0;
  });
  if (parts.length === 0) return EMPTY_ARTMESHES;
  const out = [];
  for (const part of parts) {
    const partMesh = getMesh(part, project);
    const verts = partMesh.vertices;
    const tris  = partMesh.triangles ?? [];
    const uvs   = partMesh.uvs ?? [];

    // Schema v29 fast path — `seedAllRig` persists `rigSpec.artMeshes[i]`
    // (bindings + keyforms + parent) into `part.mesh.runtime` so this
    // selector produces the SAME art-mesh output `generateCmo3` does.
    // Without this branch, bone-baked handwear angles, eye-closure
    // curves, neck-corner offsets, and variant fades all silently
    // collapse to a single rest keyform with zero bindings — and the
    // auto-fill subscriber overwrites the full rigSpec from
    // `initializeRigFromProject`, so the gap bites immediately post
    // Init Rig. See `src/store/artMeshRuntimeSync.js` for the writer
    // side.
    const runtime = partMesh.runtime;
    if (runtime && Array.isArray(runtime.keyforms) && runtime.keyforms.length > 0) {
      // M3.1 (RULE-№4, 2026-05-23): derive `cachedParent` from
      // `modifiers[0]` instead of reading `mesh.runtime.parent`.
      //
      // The runtime cache's `parent` field was historically the source
      // for "what frame are the persisted keyform verts in?" — needed
      // for the reproject path when modifiers get toggled off. Post-M1,
      // `modifiers[0]` is the canonical authoring source-of-truth for
      // the leaf modifier; the runtime cache's `parent` field is a
      // derived mirror that `persistArtMeshRuntime` writes from
      // `effectiveParent` at Init Rig time.
      //
      // For warp-rigged parts: `modifiers[0]` is a lattice with
      // `objectId` matching what `persistArtMeshRuntime` would have
      // written. For bone-baked parts (armature-only stack): no leaf,
      // cachedParent = root (matches the serialized `am.parent =
      // {type:'root', id:null}` from `_buildArtMeshes`' allDisabled
      // path). For pre-Init-Rig parts: outer guard at line 499 already
      // excludes them. Either way, derivation produces identical
      // values to the runtime.parent read it replaces.
      //
      // Type normalization mirrors `_resolveModifierChain` (lines ~798-803):
      // lattice modifier → 'warp' type in the rigSpec (lattice IS a warp
      // for chain-walking purposes); rotation stays 'rotation'. This
      // matches what `persistArtMeshRuntime` wrote into `runtime.parent`
      // pre-M3.1, so values are byte-identical at steady state.
      //
      // Path forward to M3.2/M3.3: with this read gone, runtime.parent
      // is unused by selectRigSpec; the synthesizeModifierStacks
      // fallback (deformerNodeSync.js bone-baked path) + the
      // groupRotationToBone migration are the remaining readers.
      const m0 = Array.isArray(part.modifiers) && part.modifiers.length > 0
        ? part.modifiers[0]
        : null;
      let m0LeafType = null;
      let m0LeafId = null;
      if (m0 && m0.type !== 'armature') {
        if (m0.type === 'lattice') {
          m0LeafType = 'warp';
          m0LeafId = typeof m0.objectId === 'string' ? m0.objectId : null;
        } else if (m0.type === 'rotation' || m0.type === 'warp') {
          m0LeafType = m0.type;
          m0LeafId = typeof m0.deformerId === 'string' ? m0.deformerId : null;
        }
      }
      const cachedParent = (m0LeafType && typeof m0LeafId === 'string' && m0LeafId.length > 0)
        ? { type: m0LeafType, id: m0LeafId }
        : { type: 'root', id: null };

      // Modifier-toggle live read (Blender's `BKE_modifier_is_enabled`).
      // The runtime cache was baked at Init Rig time when all modifiers
      // were enabled; if the user has since disabled any modifier, the
      // cache's `parent` may not reflect the *current* effective leaf.
      // Walk the part's modifier stack — first enabled entry wins. If
      // the effective parent differs from the cached one, re-project
      // every keyform's `vertexPositions` from the cached parent's
      // local frame to the effective parent's, so chainEval's chain
      // walk lands the geometry in the right space.
      const stackLeaf = _resolveEffectiveLeafModifier(part, nodeById);
      // M2.2 (RULE-№4, 2026-05-23): the `cachedRefInModifiers` /
      // `modifierStackComplete` gate that used to suppress the chain when
      // `runtime.parent.id` wasn't referenced by any `modifiers[]` entry
      // is retired. The gate was needed pre-RULE-№4 because bone-baked
      // parts' rotation chain lived only in `runtime.parent`. Post-RULE-№4
      // (v44 migration mandatory; v45+) the chain is always in
      // `modifiers[]`: rigWarp parts carry the lattice leaf, bone-baked
      // parts carry an Armature modifier whose `deformerId` matches the
      // bone group `cachedParent.id` (so the gate was always true). M2.1
      // already retired the matching depgraph kernel fallback; the gate
      // is the selectRigSpec twin of that dead code. `modifierChain: null`
      // is now emitted ONLY for parts with no `modifiers[]` at all
      // (`stackLeaf.hasModifiers === false`) — meaning "no per-part rig;
      // chainEval uses the cached parent verbatim".
      const effectiveParent = stackLeaf.hasModifiers
        ? stackLeaf.effectiveParent
        : cachedParent;
      const needsReproject = !_parentRefsEqual(cachedParent, effectiveParent);

      // Observability for the modifier-toggle silent reprojection path
      // (RULE-№4 audit 2026-05-23, follow-on). Disabling a modifier shifts
      // `effectiveParent` away from the cached `cachedParent`, which forces
      // a per-keyform re-projection of vertex positions between the two
      // parents' rest frames (`_reprojectKeyformVerts` below). The math
      // path is correct for well-formed warp rest states, but a missing /
      // malformed rest state silently passes verts through verbatim
      // (see _reprojectKeyformVerts), producing a geometry shift the user
      // can't trace back to their modifier toggle. Log once per
      // (part, fromParent→toParent) so the Logs panel surfaces the cause
      // without flooding (chainEval runs every frame).
      if (needsReproject) {
        const fromId = cachedParent.id ?? 'root';
        const toId = effectiveParent.id ?? 'root';
        _warnOncePerPart(`${part.id}|reproject|${fromId}->${toId}`, () => {
          logger.info(
            'selectRigSpecModifierToggleReproject',
            `modifier toggle on "${part.name ?? part.id}" — keyforms re-projected from ${cachedParent.type}:${fromId} → ${effectiveParent.type}:${toId} (cached at Init Rig; live stack diverged via per-part modifier disable)`,
            {
              partId: part.id,
              partName: part.name,
              cachedParent,
              effectiveParent,
            },
          );
        });
      }

      // FULL-BLENDER bone deformation: bone-baked parts (handwear/legwear
      // riding a bone) are deformed live by `applyBonePostChainSkin` /
      // `applyTwoBoneSkinning`, driven by `bone.pose.rotation`. The
      // emitter (`io/live2d/cmo3/artMeshSourceEmit.js`,
      // `pm.hasBakedKeyforms` branch) now produces a single rest
      // keyform on ParamOpacity[1.0] for these parts in the
      // rigCollector — no ParamRotation_<bone> binding, no per-angle
      // bake. v45 (`migrations/v45_bone_baked_art_mesh_adapter.js`)
      // forces re-Init Rig on load so existing projects shed the
      // pre-Slice-1B keyforms from their persisted `mesh.runtime`.
      // The Cubism XML export still emits N CArtMeshForm entries (the
      // adapter side; see `pm.hasBakedKeyforms` branch in
      // artMeshSourceEmit.js for the dual-track contract).
      const bindings = Array.isArray(runtime.bindings) ? runtime.bindings.map((b, i) => ({
        parameterId: b.parameterId,
        keys: coerceNumberArray(b.keys, `selectRigSpec.artMesh[${part.id}].runtime.bindings[${i}].keys`),
        interpolation: b.interpolation ?? 'LINEAR',
      })) : [];
      const keyforms = runtime.keyforms.map((k, i) => {
        const cachedVerts = coerceFloat32Array(
          k.vertexPositions,
          `selectRigSpec.artMesh[${part.id}].runtime.keyforms[${i}].vertexPositions`,
        );
        const vertexPositions = needsReproject
          ? _reprojectKeyformVerts(
              cachedVerts, cachedParent, effectiveParent,
              warpRestById, rotationRestById,
              { id: part.id, name: part.name },
            )
          : cachedVerts;
        return /** @type {object} */ ({
          keyTuple: coerceNumberArray(k.keyTuple, `selectRigSpec.artMesh[${part.id}].runtime.keyforms[${i}].keyTuple`),
          vertexPositions,
          opacity: typeof k.opacity === 'number' ? k.opacity : 1,
          ...(typeof k.drawOrder === 'number' ? { drawOrder: k.drawOrder } : {}),
        });
      });
      const flatVerts = _toFlatNumberArray(verts);
      out.push({
        id: part.id,
        name: part.name ?? part.id,
        parent: effectiveParent,
        // Per-part modifier chain (Blender semantic — modifier disable
        // skips that deformer for THIS part only, even when other parts
        // keep it active). chainEval walks this list explicitly when
        // present, instead of following the deformer's GLOBAL parent
        // pointer (which can't express divergent per-part chains for
        // shared deformers).
        //
        // Suppressed (= null) for parts with no `modifiers[]` at all —
        // chainEval treats null as "no per-part chain; use the cached
        // parent verbatim". Bone-baked parts always have at least an
        // Armature entry; `_resolveModifierChain` filters Armature out
        // (it's not a chain-deformer), so the emitted chain is `[]` and
        // chainEval early-returns while the renderer's bone post-chain
        // (`applyTwoBoneSkinning`) handles LBS.
        modifierChain: stackLeaf.hasModifiers ? stackLeaf.chain : null,
        verticesCanvas: new Float32Array(flatVerts),
        triangles: coerceUint16Array(tris, `selectRigSpec.artMesh[${part.id}].triangles`),
        uvs: coerceFloat32Array(uvs, `selectRigSpec.artMesh[${part.id}].uvs`),
        variantSuffix: part.variantSuffix ?? null,
        textureId: part.id ?? null,
        bindings,
        keyforms,
        maskMeshIds: Array.isArray(part.maskMeshIds) ? part.maskMeshIds.slice() : [],
        isVisible: part.visible !== false,
        drawOrder: typeof part.draw_order === 'number' ? part.draw_order : 0,
      });
      continue;
    }

    // Pre-rig fallback — synthesise a single canvas-px rest keyform
    // with zero bindings. Used only by projects that haven't run Init
    // Rig yet (no `mesh.runtime` populated).
    //
    // M4 (RULE-№4, 2026-05-23): the prior `part.rigParent` branch was
    // retired. `rigParent` is now a derived-only field (v48 strips it
    // from persisted saves); the body-warp `innermostBodyWarpId` is the
    // canonical pre-rig default for parts without `mesh.runtime`, which
    // matches what Init Rig itself writes for body-driven parts.
    let parentRef = { type: 'root', id: null };
    const targetParentId =
      innermostBodyWarpId && nodeById.has(innermostBodyWarpId) ? innermostBodyWarpId
      : null;
    if (targetParentId) {
      const parentNode = nodeById.get(targetParentId);
      if (isChainDeformerNode(parentNode)) {
        parentRef = isRotationDeformerNode(parentNode)
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
        // Body warp lacks a rest state (deformer was removed, or
        // synth hasn't re-derived after a structural edit). Falling
        // through to verbatim canvas-px values is wrong for downstream
        // bilinear extrapolation but won't crash; surface for triage.
        // (Pre-M4 RULE-№4 this branch fired for stale `rigParent`
        // values too; M4 retired that read so the only source for
        // `parentRef.id` here is `innermostBodyWarpId`.)
        for (let v = 0; v < flatVerts.length; v++) localVerts[v] = flatVerts[v];
        _warnOncePerPart(`${part.id}|warpRestMissing`, () => {
          logger.warn(
            'selectRigSpecPreRigFallbackOrphanWarp',
            `pre-rig fallback for "${part.name ?? part.id}" — body warp ${parentRef.id} has no rest state`,
            { partId: part.id, partName: part.name, warpId: parentRef.id },
          );
        });
      }
    } else {
      for (let v = 0; v < flatVerts.length; v++) localVerts[v] = flatVerts[v];
    }

    // Pre-rig fallback path doesn't have a modifier stack to walk —
    // chainEval falls back to the GLOBAL parent-pointer walk, which is
    // correct for projects that haven't run Init Rig yet.
    out.push({
      id: part.id,
      name: part.name ?? part.id,
      parent: parentRef,
      modifierChain: null,
      verticesCanvas: new Float32Array(flatVerts),
      triangles: coerceUint16Array(tris, `selectRigSpec.artMesh[${part.id}].triangles`),
      uvs: coerceFloat32Array(uvs, `selectRigSpec.artMesh[${part.id}].uvs`),
      variantSuffix: part.variantSuffix ?? null,
      textureId: part.id ?? null,
      bindings: [],
      keyforms: [{
        keyTuple: [],
        vertexPositions: localVerts,
        opacity: 1,
        drawOrder: typeof part.draw_order === 'number' ? part.draw_order : 0,
      }],
      maskMeshIds: Array.isArray(part.maskMeshIds) ? part.maskMeshIds.slice() : [], // string IDs, not numbers — coerce helper not applicable
      isVisible: part.visible !== false,
      drawOrder: typeof part.draw_order === 'number' ? part.draw_order : 0,
    });
  }
  return out;
}

/**
 * Walk a part's modifier stack post-`enabled` filter and return the
 * RigSpec-shaped parent ref for the first enabled modifier (the
 * effective leaf for chainEval). Mirrors Blender's
 * `BKE_modifier_is_enabled` — a disabled modifier is invisible to the
 * renderer.
 *
 * Output shape:
 *   - `hasModifiers: false`  → part has no `modifiers[]`. Caller falls
 *     back to the runtime cache or pre-rig fallback.
 *   - `hasModifiers: true, allDisabled: true`  → every modifier is
 *     disabled. Effective parent = root (the part renders with its
 *     canvas-px geometry, no chain applied).
 *   - `hasModifiers: true, effectiveParent: {type:'warp'|'rotation', id}`
 *     → at least one enabled modifier; that's the chain leaf for this
 *     part.
 *
 * @param {object} part
 * @param {Map<string, object>} nodeById
 * @returns {{hasModifiers: boolean, allDisabled: boolean, effectiveParent: {type:string,id:string|null}}}
 */
/**
 * The chain-node id a modifier references. v43 lattice (warp) modifiers
 * reference their cage object via `objectId`; rotation modifiers reference
 * their deformer node via `deformerId`. Armature modifiers (no chain node)
 * yield null.
 *
 * @param {object|null|undefined} mod
 * @returns {string|null}
 */
function _modifierRefId(mod) {
  if (!mod || typeof mod !== 'object') return null;
  if (mod.type === 'lattice') {
    return typeof mod.objectId === 'string' ? mod.objectId : null;
  }
  return typeof mod.deformerId === 'string' ? mod.deformerId : null;
}

function _resolveEffectiveLeafModifier(part, nodeById) {
  const chain = _resolveModifierChain(part, nodeById);
  if (chain === null) {
    return { hasModifiers: false, allDisabled: false, effectiveParent: { type: 'root', id: null }, chain: [] };
  }
  if (chain.length === 0) {
    return { hasModifiers: true, allDisabled: true, effectiveParent: { type: 'root', id: null }, chain };
  }
  return {
    hasModifiers: true,
    allDisabled: false,
    effectiveParent: chain[0],
    chain,
  };
}

/**
 * Resolve a part's *active* modifier chain (post-`enabled` + mode-bitmask
 * filter), leaf-first. Returns:
 *   - `null` if the part has no `modifiers[]` at all (caller falls back
 *     to runtime cache or pre-rig fallback).
 *   - `[]` if every modifier is hidden under the live-render context.
 *   - non-empty `[{type, id}, ...]` otherwise.
 *
 * This is the per-part chain that `chainEval` walks for this artMesh.
 * Replaces the global `parent`-pointer walk for parts whose modifier
 * stack diverges from the natural topology — needed because a shared
 * deformer (BodyXWarp etc.) cannot have different `parent` edges per
 * part, but disabling a *middle* modifier (BreathWarp on topwear) means
 * topwear's chain genuinely skips it while face's chain still includes
 * it.
 *
 * @param {object} part
 * @param {Map<string, object>} nodeById
 * @returns {Array<{type: string, id: string}>|null}
 */
function _resolveModifierChain(part, nodeById) {
  if (!part || !Array.isArray(part.modifiers) || part.modifiers.length === 0) {
    return null;
  }
  /** @type {Array<{type: string, id: string}>} */
  const chain = [];
  for (const mod of part.modifiers) {
    // v43 — a warp modifier references its cage object via `objectId`; a
    // rotation modifier references its deformer node via `deformerId`.
    const refId = _modifierRefId(mod);
    if (typeof refId !== 'string') continue;
    if (mod.enabled === false) continue;
    const mode = typeof mod.mode === 'number'
      ? mod.mode
      : (MODIFIER_MODE_REALTIME | MODIFIER_MODE_RENDER);
    if ((mode & LIVE_RENDER_REQUIRED_MODE) === 0) continue;
    const target = nodeById.get(refId);
    if (!isChainDeformerNode(target)) continue;
    const type = isRotationDeformerNode(target) ? 'rotation' : 'warp';
    chain.push({ type, id: refId });
  }
  return chain;
}

/**
 * Structural equality on RigSpec parent refs.
 *
 * @param {{type?:string,id?:string|null}|null|undefined} a
 * @param {{type?:string,id?:string|null}|null|undefined} b
 */
function _parentRefsEqual(a, b) {
  const at = a?.type ?? 'root';
  const bt = b?.type ?? 'root';
  const ai = a?.id ?? null;
  const bi = b?.id ?? null;
  return at === bt && ai === bi;
}

/**
 * Re-project a flat vertex buffer from `fromParent`'s local frame to
 * `toParent`'s. Used when the user toggles a modifier off and the
 * runtime-cached `parent` no longer matches the modifier stack's
 * effective leaf — the cached `vertexPositions` are in the *cached*
 * parent's frame and need lifting to canvas-px before being
 * normalised back into the new parent's frame.
 *
 * Frame definitions match `runtime/evaluator/frameConvert.js`:
 *   - root parent       → canvas-px verbatim
 *   - warp parent       → 0..1 normalised over the parent's REST canvas bbox
 *   - rotation parent   → canvas-px offsets from the parent's pivot
 *
 * Falls back to passing the buffer through unchanged when either side's
 * rest state is unavailable (defensive — the chain renders with
 * mild geometric drift rather than throwing).
 *
 * @param {Float32Array | ArrayLike<number>} verts
 * @param {{type:string,id:string|null}} fromParent
 * @param {{type:string,id:string|null}} toParent
 * @param {Map<string, {bbox:{minX:number,minY:number,maxX:number,maxY:number}}>} warpRestById
 * @param {Map<string, {pivot:{x:number,y:number}}>} rotationRestById
 * @param {{id?:string, name?:string}} [partRefForDiag] - optional part
 *   identity for once-per-part diagnostic logging when the silent-
 *   passthrough path fires (RULE-№4 audit follow-on, 2026-05-23).
 * @returns {Float32Array}
 */
function _reprojectKeyformVerts(verts, fromParent, toParent, warpRestById, rotationRestById, partRefForDiag) {
  const fromCtx = _buildFrameCtx(fromParent, warpRestById, rotationRestById);
  const toCtx = _buildFrameCtx(toParent, warpRestById, rotationRestById);
  if (fromCtx === null || toCtx === null) {
    // One side has no rest state — defensive passthrough produces
    // verts in the WRONG frame for chainEval downstream (the cached-
    // frame local values pass through unchanged into what chainEval
    // treats as the effective-frame local values, producing a silent
    // geometry shift the user can't trace back to their modifier
    // toggle). Surface once per (part, fromParent, toParent, side)
    // so the Logs panel exposes the missing rest state.
    if (partRefForDiag && typeof partRefForDiag.id === 'string') {
      const missing = fromCtx === null ? 'cached' : 'effective';
      const missingRef = fromCtx === null ? fromParent : toParent;
      _warnOncePerPart(
        `${partRefForDiag.id}|reprojectPassthrough|${missing}|${missingRef.type}:${missingRef.id ?? 'root'}`,
        () => {
          logger.warn(
            'selectRigSpecReprojectSilentPassthrough',
            `keyform reprojection on "${partRefForDiag.name ?? partRefForDiag.id}" silently passed verts through — ${missing} parent ${missingRef.type}:${missingRef.id ?? 'root'} has no rest state; downstream geometry will be in the wrong frame`,
            {
              partId: partRefForDiag.id,
              partName: partRefForDiag.name,
              missingSide: missing,
              missingParent: missingRef,
              fromParent,
              toParent,
            },
          );
        },
      );
    }
    const out = new Float32Array(verts.length);
    for (let i = 0; i < verts.length; i++) out[i] = verts[i];
    return out;
  }
  const out = new Float32Array(verts.length);
  for (let i = 0; i < verts.length; i += 2) {
    const lx = verts[i];
    const ly = verts[i + 1];
    // Step 1: cached-frame local → canvas-px (rest configuration —
    // we use the parent's REST canvas bbox / REST pivot, NOT the
    // deformed grid; chainEval applies the deformation downstream).
    let cx, cy;
    if (fromCtx.kind === 'canvas') {
      cx = lx; cy = ly;
    } else if (fromCtx.kind === 'warp') {
      cx = fromCtx.minX + lx * fromCtx.W;
      cy = fromCtx.minY + ly * fromCtx.H;
    } else /* rotation */ {
      cx = fromCtx.pivotX + lx;
      cy = fromCtx.pivotY + ly;
    }
    // Step 2: canvas-px → effective-frame local.
    let nx, ny;
    if (toCtx.kind === 'canvas') {
      nx = cx; ny = cy;
    } else if (toCtx.kind === 'warp') {
      nx = toCtx.W > 0 ? (cx - toCtx.minX) / toCtx.W : 0;
      ny = toCtx.H > 0 ? (cy - toCtx.minY) / toCtx.H : 0;
    } else /* rotation */ {
      nx = cx - toCtx.pivotX;
      ny = cy - toCtx.pivotY;
    }
    out[i] = nx;
    out[i + 1] = ny;
  }
  return out;
}

/**
 * Build a frame conversion context for a parent ref. Returns `null`
 * iff the parent is a warp/rotation but its rest state hasn't been
 * computed (broken chain). Root parent always succeeds with
 * `{kind:'canvas'}`.
 *
 * @param {{type:string,id:string|null}} parent
 * @param {Map<string, {bbox:{minX:number,minY:number,maxX:number,maxY:number}}>} warpRestById
 * @param {Map<string, {pivot:{x:number,y:number}}>} rotationRestById
 */
function _buildFrameCtx(parent, warpRestById, rotationRestById) {
  if (!parent || parent.type === 'root' || !parent.id) {
    return { kind: 'canvas' };
  }
  if (parent.type === 'warp') {
    const restState = warpRestById.get(parent.id);
    if (!restState?.bbox) return null;
    const { minX, minY, maxX, maxY } = restState.bbox;
    return {
      kind: 'warp',
      minX, minY,
      W: (maxX - minX) || 1,
      H: (maxY - minY) || 1,
    };
  }
  if (parent.type === 'rotation') {
    const restState = rotationRestById.get(parent.id);
    if (!restState?.pivot) return null;
    return { kind: 'rotation', pivotX: restState.pivot.x, pivotY: restState.pivot.y };
  }
  // part / group — treat as canvas (chainEval treats unresolved
  // parents as root).
  return { kind: 'canvas' };
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
    baseGrid: coerceFloat64Array(node.baseGrid, `selectRigSpec.warp[${node.id}].baseGrid`),
    localFrame: node.localFrame ?? 'canvas-px',
    bindings: (node.bindings ?? []).map((b, i) => ({
      parameterId: b.parameterId,
      keys: coerceNumberArray(b.keys, `selectRigSpec.warp[${node.id}].bindings[${i}].keys`),
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (node.keyforms ?? []).map((k, i) => ({
      keyTuple: coerceNumberArray(k.keyTuple, `selectRigSpec.warp[${node.id}].keyforms[${i}].keyTuple`),
      positions: coerceFloat64Array(k.positions, `selectRigSpec.warp[${node.id}].keyforms[${i}].positions`),
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
    bindings: (node.bindings ?? []).map((b, i) => ({
      parameterId: b.parameterId,
      keys: coerceNumberArray(b.keys, `selectRigSpec.rotation[${node.id}].bindings[${i}].keys`),
      interpolation: b.interpolation ?? 'LINEAR',
    })),
    keyforms: (node.keyforms ?? []).map((k, i) => ({
      keyTuple: coerceNumberArray(k.keyTuple, `selectRigSpec.rotation[${node.id}].keyforms[${i}].keyTuple`),
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
  if (isRotationDeformerNode(parent)) return { type: 'rotation', id: parentId };
  if (isWarpLatticeNode(parent)) return { type: 'warp', id: parentId };
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
  // M3.2 (RULE-№4, 2026-05-23): the topology walk that picks the deepest
  // body-warp leaf moved to `store/warpLatticeAccess.findInnermostBodyWarpId`
  // so the synth's bone-baked fallback shares ONE implementation with
  // this selector. The CLOSURES (`canvasToInnermostX/Y`) stay here
  // because they need `warpRestById` from the rest-lift pipeline.
  const best = findInnermostBodyWarpId(warpNodes, allDeformerNodes);
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

