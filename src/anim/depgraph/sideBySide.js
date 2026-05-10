// @ts-check

/**
 * Side-by-side eval validator.
 *
 * Phase D-6 of the V2 plan. Runs BOTH the classic chainEval pipeline
 * and the depgraph eval pipeline against the same project + param
 * values, and produces a structured diff report. Used by:
 *
 *   - The dev-only debug overlay (planned: a Logs panel signal that
 *     flares if any per-frame divergence is detected during the
 *     2-week soak).
 *   - The Shelby byte-fidelity gate: `scripts/byteFidelity/check_shelby.mjs`
 *     can call this with the user's fixture to validate engine parity
 *     before flipping the default flag to `'depgraph'`.
 *
 * # What it compares
 *
 * - **Lifted grids**: every warp's `getLiftedGrid` output (chainEval
 *   `cache.getLiftedGrid` vs depgraph `GRID_LIFT_TO_PARENT`).
 *   Per-CP float-eq within `tol`.
 * - **Rotation matrices**: every rotation deformer's MATRIX_BUILD
 *   output (chainEval `cache.getState(...).mat` vs depgraph
 *   `MATRIX_BUILD`). 9-element float-eq within `tol`.
 *
 * # What it does NOT compare (yet)
 *
 * - Per-part deformed positions (the full `evalArtMeshFrame` output).
 *   Phase D-6's full byte-fidelity gate runs on the user's Shelby
 *   fixture via `check_shelby.mjs` against pre-V2 baseline cmo3/moc3
 *   bytes — which is the operational truth, not per-frame diffs.
 *
 * @module anim/depgraph/sideBySide
 */

import { selectRigSpec } from '../../io/live2d/rig/selectRigSpec.js';
import { evalRig, DeformerStateCache } from '../../io/live2d/runtime/evaluator/chainEval.js';
import { buildDepGraph } from './build.js';
import { evalDepGraph } from './eval.js';

/**
 * @typedef {object} DivergenceEntry
 * @property {string} deformerId
 * @property {('lifted'|'matrix')} kind
 * @property {number} maxAbsDelta
 * @property {number} elementCount
 *
 * @typedef {object} SideBySideReport
 * @property {boolean} identical
 * @property {DivergenceEntry[]} divergences
 * @property {number} chainEvalMs
 * @property {number} depgraphMs
 * @property {number} liftedGridCount
 * @property {number} matrixCount
 */

/**
 * Run both engines and return a structured diff report.
 *
 * @param {object} project
 * @param {Record<string, number>} paramValues
 * @param {{ tol?: number }} [opts]
 * @returns {SideBySideReport}
 */
export function runSideBySide(project, paramValues, opts = {}) {
  const tol = opts.tol ?? 1e-6;

  // --- chainEval reference ---
  const t1 = nowMs();
  const rigSpec = selectRigSpec(project);
  /** @type {Map<string, Float64Array>} */
  const chainLifted = new Map();
  evalRig(rigSpec, paramValues, { out: { liftedGrids: chainLifted } });
  /** @type {Map<string, Float64Array>} */
  const chainMatrices = collectChainMatrices(rigSpec, paramValues);
  const chainEvalMs = nowMs() - t1;

  // --- depgraph candidate ---
  const t2 = nowMs();
  const graph = buildDepGraph(project, {});
  const overrides = new Map(Object.entries(paramValues ?? {}));
  const ctx = evalDepGraph(graph, { project, time: 0, paramOverrides: overrides });
  const depLifted = collectDepgraphLifted(ctx);
  const depMatrices = collectDepgraphMatrices(ctx);
  const depgraphMs = nowMs() - t2;

  /** @type {DivergenceEntry[]} */
  const divergences = [];

  // Diff lifted grids.
  const liftedIds = new Set([...chainLifted.keys(), ...depLifted.keys()]);
  for (const id of liftedIds) {
    const a = chainLifted.get(id);
    const b = depLifted.get(id);
    const delta = floatArrayMaxAbsDelta(a, b);
    if (delta > tol) {
      divergences.push({
        deformerId: id,
        kind: 'lifted',
        maxAbsDelta: delta,
        elementCount: (a?.length ?? b?.length ?? 0),
      });
    }
  }

  // Diff matrices.
  const matrixIds = new Set([...chainMatrices.keys(), ...depMatrices.keys()]);
  for (const id of matrixIds) {
    const a = chainMatrices.get(id);
    const b = depMatrices.get(id);
    const delta = floatArrayMaxAbsDelta(a, b);
    if (delta > tol) {
      divergences.push({
        deformerId: id,
        kind: 'matrix',
        maxAbsDelta: delta,
        elementCount: 9,
      });
    }
  }

  return {
    identical: divergences.length === 0,
    divergences,
    chainEvalMs,
    depgraphMs,
    liftedGridCount: liftedIds.size,
    matrixCount: matrixIds.size,
  };
}

function nowMs() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

/**
 * @param {Float64Array | Float32Array | undefined} a
 * @param {Float64Array | Float32Array | undefined} b
 * @returns {number}
 */
function floatArrayMaxAbsDelta(a, b) {
  if (!a || !b) return Infinity;
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > m) m = d;
  }
  return m;
}

/**
 * Collect the per-rotation `mat` (Float64Array(9)) from chainEval. The
 * matrices are produced lazily by `cache.getState()` during artMesh
 * eval; calling getState directly here force-touches each rotation so
 * we can diff against the depgraph's `MATRIX_BUILD` outputs.
 *
 * Phase 0.A — closes a stub gap: previously this returned an empty Map,
 * which surfaced every depgraph rotation as `maxAbsDelta=Infinity` in
 * the report. The lifted-grid diff was the bug indicator; the matrix
 * diff was just noise.
 *
 * @param {import('../../io/live2d/rig/rigSpec.js').RigSpec} rigSpec
 * @param {Record<string, number>} paramValues
 * @returns {Map<string, Float64Array>}
 */
function collectChainMatrices(rigSpec, paramValues) {
  const out = new Map();
  const rotations = Array.isArray(rigSpec.rotationDeformers)
    ? rigSpec.rotationDeformers : [];
  if (rotations.length === 0) return out;
  // Spin up a fresh cache on the same rigSpec + paramValues. Matrices
  // are a pure function of those inputs, so the result is bytewise
  // identical to what evalRig's internal cache would produce.
  // Default kernel matches evalRig's default (`cubism-setup` since
  // 2026-05-03). If the production kernel ever changes, mirror it
  // here so the diff stays apples-to-apples.
  const cache = new DeformerStateCache(rigSpec, paramValues, { kernel: 'cubism-setup' });
  for (const r of rotations) {
    if (!r?.id) continue;
    const state = cache.getState(r);
    if (state?.kind === 'rotation' && state.mat) {
      // Copy to a stable Float64Array — pool buffers in the cache may
      // get reused across calls and would mutate under the diff caller.
      out.set(r.id, Float64Array.from(state.mat));
    }
  }
  return out;
}

/**
 * @param {import('./eval.js').EvalContext} ctx
 * @returns {Map<string, Float64Array>}
 */
function collectDepgraphLifted(ctx) {
  const out = new Map();
  for (const [name, value] of ctx.outputs) {
    if (!name.endsWith('/GEOMETRY/GRID_LIFT_TO_PARENT')) continue;
    if (!value?.lifted) continue;
    const id = name.split('/')[0];
    out.set(id, value.lifted);
  }
  return out;
}

/**
 * @param {import('./eval.js').EvalContext} ctx
 * @returns {Map<string, Float64Array>}
 */
function collectDepgraphMatrices(ctx) {
  const out = new Map();
  for (const [name, value] of ctx.outputs) {
    if (!name.endsWith('/GEOMETRY/MATRIX_BUILD')) continue;
    if (!value?.mat) continue;
    const id = name.split('/')[0];
    out.set(id, value.mat);
  }
  return out;
}
