// @ts-check

/**
 * v23 — Blender Parity V2 Phase N-2: DriverTree datablock migration.
 *
 * Lifts every parameter's `driver` record into a derived `DriverTree`
 * stored on `project.nodeTrees.driver[paramId]`. Each tree's structure:
 *
 *   ParamInput(varA) → Math(*) → DriverOutput(targetParamId)
 *               ⤴
 *   Constant(2) ─┘
 *
 * The compile pass (`anim/nodetree/driverCompile.js`) parses the
 * driver expression into a graph; unparseable expressions wrap a
 * single `ScriptedExpression` node that delegates to `evaluateDriver`.
 *
 * # Idempotency
 *
 * Re-running overwrites existing entries with freshly-compiled trees
 * — the compile is deterministic on the canonical
 * `param.driver` record, so re-runs converge.
 *
 * # Side-by-side with N-1
 *
 * v23 doesn't touch `param.driver` itself; the original driver record
 * stays canonical for one release. The tree is a dual-write shadow
 * for the Phase N-4 visual editor.
 *
 * @module store/migrations/v23_nodetree_drivertree
 */

import { compileDriverTree } from '../../anim/nodetree/driverCompile.js';
// Side-effect import: registers ParamInput/Constant/Math/Compare/
// DriverOutput/ScriptedExpression node types in the registry. Required
// for evalNodeTree to dispatch them.
import '../../anim/nodetree/nodes/drivers.js';

/**
 * @param {object} project - mutated in place
 */
export function migrateNodeTreeDriverTree(project) {
  if (!project) return project;

  if (!project.nodeTrees || typeof project.nodeTrees !== 'object') {
    project.nodeTrees = { rig: {}, driver: {}, animation: {} };
  } else {
    if (!project.nodeTrees.rig)       project.nodeTrees.rig = {};
    if (!project.nodeTrees.driver)    project.nodeTrees.driver = {};
    if (!project.nodeTrees.animation) project.nodeTrees.animation = {};
  }

  /** @type {Record<string, import('../../anim/nodetree/types.js').NodeTree>} */
  const driverTrees = {};
  for (const param of project.parameters ?? []) {
    if (!param?.id || !param.driver) continue;
    driverTrees[param.id] = compileDriverTree(param.id, param.driver);
  }
  project.nodeTrees.driver = driverTrees;

  return project;
}
