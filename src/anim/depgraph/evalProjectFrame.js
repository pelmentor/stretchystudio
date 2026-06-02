// @ts-check

/**
 * Production-shape depgraph runner.
 *
 * Phase 0.D.0 of the Animation Blender-Parity Plan. Provides a
 * drop-in replacement for `evalRig` that routes every art mesh
 * through the depgraph's `ART_MESH_EVAL` op. The returned shape
 * matches `chainEval.evalRig` (`ArtMeshFrame[]`) so consumers can
 * swap engines without altering the renderer.
 *
 * # Wiring
 *
 *   const frames = evalProjectFrameViaDepgraph(project, paramValues);
 *   //   ↪ frames[i] = { id, vertexPositions, opacity, drawOrder }
 *
 * `paramValues` is a flat `{ paramId: value }` map (matching evalRig's
 * second arg). The runner copies each entry into the depgraph's
 * `paramOverrides` map so PARAM_EVAL kernels pick up the values; from
 * there, FCURVE_EVAL / DRIVER_EVAL / ANIMATION_TRACK_EVAL / PHYSICS_EVAL
 * may overwrite them inside the eval pass.
 *
 * # Relationship to `evalRig`
 *
 * `evalRig` is the chainEval entry point — still used for the armature
 * modifier bake (`ArmatureModifierService`) and the depgraph
 * side-by-side test harness. `evalProjectFrameViaDepgraph` is the sole
 * VIEWPORT eval path (Phase 0.D.0 wire-in; the `evalEngine: 'classic'`
 * opt-out that let the viewport tick choose `evalRig` was removed in
 * the Phase 7 close-out). They remain swap-compatible at the
 * `ArtMeshFrame` boundary.
 *
 * @module anim/depgraph/evalProjectFrame
 */

import { buildDepGraph } from './build.js';
import { evalDepGraph } from './eval.js';
import { OperationCode, NodeType } from './types.js';
import { resolveBoneWorldFromCtx } from './kernels/bonePostChain.js';
import { isBoneGroup } from '../../store/objectDataAccess.js';

/**
 * @typedef {object} ArtMeshFrame
 * @property {string} id
 * @property {Float32Array} vertexPositions
 * @property {number} opacity
 * @property {number} drawOrder
 */

/**
 * Evaluate every art mesh in the project via the depgraph. Output
 * shape matches `evalRig`.
 *
 * @param {object} project
 * @param {Record<string, number>} paramValues
 * @param {object} [opts]
 * @param {object|null} [opts.action] - active action datablock; when set,
 *   the depgraph's ANIMATION_TRACK_EVAL kernel evaluates fcurves at
 *   `opts.timeMs`. Pass null when no action is active.
 * @param {number} [opts.timeMs] - playhead time in milliseconds
 *   (Phase 0.0 canonical unit). Defaults to 0.
 * @param {number} [opts.requiredMode] - modifier mode bitmask
 * @param {Map<string, Float64Array>} [opts.liftedGrids] - when provided,
 *   the runner fills it with every warp deformer's canvas-px lifted
 *   control-point grid (keyed by deformer id), for the WarpDeformerOverlay
 *   debug visualization. The depgraph already composes these as
 *   GRID_LIFT_TO_PARENT outputs; this just surfaces them. Replaces the
 *   classic engine's `evalRig({ out: { liftedGrids } })` path that the
 *   overlay relied on before the depgraph became the sole viewport engine.
 * @param {Map<string, Record<string, any>>} [opts.poseOverrides] - the
 *   viewport's `computePoseOverrides` map (action fcurves + draftPose).
 *   TRANSFORM_COMPOSE seeds each owner's pose from the transform channels
 *   here so bone/part pose animation drives skinning. Non-transform
 *   entries (mesh_verts etc.) are ignored. Omit for the static case.
 * @param {object} [opts.rigSpec] - selectRigSpec output. When provided, the
 *   ART_MESH_EVAL kernel sources each part's keyform-blend input (bindings +
 *   keyforms) from the matching `rigSpec.artMeshes[]` entry instead of the
 *   raw `mesh.runtime`. selectRigSpec reprojects keyform verts into the
 *   effective leaf-parent frame when a modifier is toggled off
 *   (`needsReproject`); the raw runtime cache is still in the BAKED leaf
 *   frame, so without this the chain walk lands toggled-modifier parts in
 *   the wrong place. For the common (no-toggle) case the rigSpec keyforms
 *   are identical to runtime, so this is a no-op there.
 * @param {Map<string, Float32Array>} [opts.outBoneWorldMatrices] - when
 *   provided, the runner fills it with each bone's WORLD matrix derived
 *   from the depgraph's TRANSFORM_COMPOSE outputs (constraint-aware,
 *   keyed by bone id). This is the constraint-aware sibling of
 *   `renderer/boneOverlayMatrix.js#computeBoneWorldMatrices`, which
 *   reads `node.pose` directly and silently bypasses COPY_ROTATION /
 *   TRACK_TO / LIMIT_ROTATION constraints. `ArmatureModifierService`
 *   consumes this so Apply respects constraints (rule-4-05 fix).
 * @returns {ArtMeshFrame[]}
 */
export function evalProjectFrameViaDepgraph(project, paramValues, opts = {}) {
  const graph = buildDepGraph(project, opts.action ? { action: opts.action } : {});
  const overrides = new Map();
  if (paramValues && typeof paramValues === 'object') {
    for (const k of Object.keys(paramValues)) {
      const v = paramValues[k];
      if (typeof v === 'number' && Number.isFinite(v)) overrides.set(k, v);
    }
  }
  const ctx = evalDepGraph(graph, {
    project,
    timeMs: opts.timeMs ?? 0,
    paramOverrides: overrides,
    action: opts.action ?? null,
    requiredMode: opts.requiredMode,
    rigArtMeshById: buildRigArtMeshIndex(opts.rigSpec),
    poseOverrides: buildPoseOverrideIndex(opts.poseOverrides),
  });
  /** @type {ArtMeshFrame[]} */
  const frames = [];
  for (const node of project.nodes ?? []) {
    if (!node || node.type !== 'part') continue;
    const key = `${node.id}/${NodeType.GEOMETRY}/${OperationCode.ART_MESH_EVAL}`;
    const out = ctx.outputs.get(key);
    if (!out || !out.vertexPositions) continue;
    frames.push({
      id: out.id ?? node.id,
      vertexPositions: out.vertexPositions,
      opacity: typeof out.opacity === 'number' ? out.opacity : 1,
      drawOrder: typeof out.drawOrder === 'number' ? out.drawOrder : (node.draw_order ?? 500),
    });
  }
  // Surface lifted warp grids for the debug overlay when requested. The
  // GRID_LIFT_TO_PARENT outputs are keyed `${deformerId}/GEOMETRY/<op>`;
  // their `.lifted` field is the canvas-px control-point array the overlay
  // projects directly.
  if (opts.liftedGrids instanceof Map) {
    const suffix = `/${NodeType.GEOMETRY}/${OperationCode.GRID_LIFT_TO_PARENT}`;
    for (const [opKey, out] of ctx.outputs) {
      if (!opKey.endsWith(suffix) || !out?.lifted) continue;
      const deformerId = opKey.slice(0, opKey.length - suffix.length);
      opts.liftedGrids.set(deformerId, out.lifted);
    }
  }
  // Surface bone WORLD matrices derived from depgraph TRANSFORM_COMPOSE
  // outputs (constraint-aware) for callers that bake or skin against the
  // current bone pose. Mirrors `liftedGrids` shape — caller passes a Map,
  // we populate. This is the constraint-aware sibling of
  // `renderer/boneOverlayMatrix.js#computeBoneWorldMatrices`, which reads
  // `node.pose` directly and therefore SKIPS the COPY_ROTATION /
  // TRACK_TO / LIMIT_ROTATION constraint stack. `ArmatureModifierService`
  // is the production consumer (rule-4-05 fix); Apply now respects
  // constraints, matching what the viewport renders.
  if (opts.outBoneWorldMatrices instanceof Map) {
    const nodes = project?.nodes ?? [];
    /** @type {Map<string, object>} */
    const byId = new Map();
    for (const n of nodes) if (n?.id) byId.set(n.id, n);
    const cache = new Map();
    for (const n of nodes) {
      if (!isBoneGroup(n)) continue;
      const world = resolveBoneWorldFromCtx(n.id, ctx, byId, cache);
      opts.outBoneWorldMatrices.set(n.id, world);
    }
  }
  return frames;
}

/**
 * Convert the viewport's `computePoseOverrides` output —
 * `Map<nodeId, {property: value}>`, which also carries `mesh_verts` /
 * `blendShape:*` / `opacity` entries — into the depgraph's
 * `Map<nodeId, Map<channel, number>>`, keeping ONLY the affine transform
 * channels (rotation/x/y/scaleX/scaleY). TRANSFORM_COMPOSE seeds the
 * owner's pose from this so bone/part pose animation reaches skinning.
 * Non-transform overrides (mesh_verts etc.) are dropped here — the
 * viewport applies those as post-eval vertex uploads. Returns null when
 * nothing relevant is present so `evalDepGraph` uses a fresh map (which
 * ANIMATION_TRACK_EVAL still fills for the standalone test/export path).
 *
 * @param {Map<string, Record<string, any>>|undefined} poseOverrides
 * @returns {Map<string, Map<string, number>>|null}
 */
function buildPoseOverrideIndex(poseOverrides) {
  if (!(poseOverrides instanceof Map) || poseOverrides.size === 0) return null;
  const channels = ['rotation', 'x', 'y', 'scaleX', 'scaleY'];
  /** @type {Map<string, Map<string, number>>} */
  const out = new Map();
  for (const [nodeId, ov] of poseOverrides) {
    if (!ov || typeof ov !== 'object') continue;
    let m = null;
    for (const ch of channels) {
      const v = ov[ch];
      if (typeof v === 'number' && Number.isFinite(v)) {
        if (!m) m = new Map();
        m.set(ch, v);
      }
    }
    if (m) out.set(nodeId, m);
  }
  return out.size > 0 ? out : null;
}

/**
 * Index `rigSpec.artMeshes[]` by part id for O(1) lookup in the
 * ART_MESH_EVAL kernel. Returns null when no rigSpec is supplied (the
 * kernel then falls back to raw `mesh.runtime`).
 *
 * @param {object|undefined} rigSpec
 * @returns {Map<string, object>|null}
 */
function buildRigArtMeshIndex(rigSpec) {
  if (!rigSpec || !Array.isArray(rigSpec.artMeshes)) return null;
  const m = new Map();
  for (const am of rigSpec.artMeshes) {
    if (am?.id) m.set(am.id, am);
  }
  return m;
}
