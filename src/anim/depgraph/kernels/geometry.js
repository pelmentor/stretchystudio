// @ts-check

/**
 * GEOMETRY_EVAL_DEFORMED kernel.
 *
 * Phase D-3a of the V2 plan. Iterates the part's `Object.modifiers[]`
 * stack, dispatches each modifier through `MODIFIER_TYPES[type].deformVerts`,
 * and stores the resulting vertex positions in `ctx.outputs`.
 *
 * **This is the modifier-eval flip in code form.** Today's chainEval
 * walks the parent-link tree from leaf to root; this kernel iterates
 * the explicit modifier list. The two are equivalent today (parent
 * links are derived from stacks via `synthesizeDeformerParents` since
 * Phase 0.3) — the V2 depgraph kernel just makes the iteration
 * explicit.
 *
 * # Iteration order (Audit Gap D)
 *
 * `part.modifiers[]` is leaf-first per `synthesizeModifierStacks` —
 * `[innermost, ..., outermost]`. The Blender modifier stack convention
 * is also leaf-first applies first
 * (`reference/blender/source/blender/blenkernel/intern/DerivedMesh.cc`'s
 * `mesh_calc_modifiers` walks `md = next` from the head). Pinned in
 * `test_modifierIterationOrder.mjs`.
 *
 * # Mode-flag gate
 *
 * Each modifier is checked via `isModifierEnabled(mod, ctx.requiredMode)`
 * before its `deformVerts` is invoked. Default `ctx.requiredMode` is
 * `MODE_REALTIME` (viewport eval). The export pipeline supplies
 * `MODE_RENDER`. Audit Gap C is pinned in `test_modifierTypeInfo.mjs`.
 *
 * @module anim/depgraph/kernels/geometry
 */

import {
  MODIFIER_TYPES,
  isModifierEnabled,
  MODIFIER_MODE_REALTIME,
} from '../../modifierTypeInfo.js';
import { getMesh } from '../../../store/objectDataAccess.js';

/**
 * @param {import('../types.js').OperationNode} op
 * @param {import('../eval.js').EvalContext} ctx
 * @returns {{positions: Float32Array, modifierTrace: Array<{deformerId: string, applied: boolean, reason: string}>} | null}
 */
export function kernelGeometryEvalDeformed(op, ctx) {
  const idNode = op.owner?.owner;
  if (!idNode) return null;
  const partId = idNode.idRef;
  const part = ctx.project?.nodes?.find((n) => n?.id === partId && n.type === 'part');
  if (!part) return null;

  const mesh = getMesh(part, ctx.project);
  /** @type {Float32Array} */
  const sourceVerts = mesh && Array.isArray(mesh.vertices)
    ? new Float32Array(mesh.vertices)
    : new Float32Array(0);

  // Buffer chain: each modifier reads `read`, writes `write`. Phase
  // D-3a's deformVerts callbacks are pass-through stubs (Phase D-3b
  // wires real bilinear/affine kernels) — the buffer chain below is
  // already correct so D-3b only swaps in the kernel bodies.
  let positions = sourceVerts;

  /** @type {Array<{deformerId: string, applied: boolean, reason: string}>} */
  const modifierTrace = [];
  const requiredMode = ctx.requiredMode ?? MODIFIER_MODE_REALTIME;
  const stack = Array.isArray(part.modifiers) ? part.modifiers : [];

  let collapsed = false;
  for (const mod of stack) {
    if (collapsed) {
      // Canvas-final modifier already collapsed the chain — remaining
      // modifiers are encoded in the lifted state we just applied.
      // Trace them as skipped-by-collapse so the diagnostic surfaces
      // why iteration stopped.
      modifierTrace.push({
        deformerId: mod?.deformerId ?? '<unknown>',
        applied: false, reason: 'collapsed-by-canvas-final',
      });
      continue;
    }
    if (!mod?.deformerId) {
      modifierTrace.push({
        deformerId: mod?.deformerId ?? '<unknown>',
        applied: false, reason: 'missing deformerId',
      });
      continue;
    }
    if (!isModifierEnabled(mod, requiredMode)) {
      modifierTrace.push({
        deformerId: mod.deformerId,
        applied: false, reason: 'mode-gated',
      });
      continue;
    }
    const typeInfo = MODIFIER_TYPES[mod.type];
    if (!typeInfo) {
      modifierTrace.push({
        deformerId: mod.deformerId,
        applied: false, reason: `unknown type ${mod.type}`,
      });
      continue;
    }
    const { positions: nextPos, isCanvasFinal } =
      typeInfo.deformVerts(mod, ctx, mesh ?? {}, positions);
    positions = nextPos;
    collapsed = isCanvasFinal === true;
    modifierTrace.push({
      deformerId: mod.deformerId,
      applied: true, reason: collapsed ? 'ok-canvas-final' : 'ok',
    });
  }

  return { positions, modifierTrace };
}
