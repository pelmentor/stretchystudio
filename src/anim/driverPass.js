// @ts-check

/**
 * Phase 5 — Project-wide driver evaluation pass.
 *
 * Walks every driver-bound target in the project and evaluates it,
 * returning a map of `rnaPath → driverValue` overrides. Mirrors
 * Blender's per-evaluator-tick driver pass (`BKE_animsys_evaluate_all_animation`
 * → driver eval) but at SS scope: a single sweep, no dependency graph.
 *
 * # Where drivers live in SS
 *
 *   1. **FCurves on animation tracks** — `track.driver` overrides the
 *      keyframe-driven value when the curve is evaluated. Already
 *      handled by `evaluateFCurve` itself; not collected here.
 *   2. **Param drivers** — a parameter can carry `param.driver` to
 *      compute its current value as a function of OTHER params /
 *      transforms. No keyframes; the driver IS the value.
 *   3. **Transform drivers** — a node's transform field can carry
 *      `node.transformDrivers[<field>]` (e.g. `transformDrivers.rotation`)
 *      that overrides the field at eval time. Same shape as Blender's
 *      "rotation_euler[1]" driver target.
 *
 * This pass collects (2) and (3) and produces a flat override map.
 * Caller (animationEngine / chainEval) merges these into its own
 * value table BEFORE the deformer chain evaluates.
 *
 * # Driver shape (from `anim/driver.js`)
 *
 *   {
 *     id?:        string,
 *     type:       'sum'|'min'|'max'|'avg'|'scripted',
 *     expression?: string,    // for 'scripted'
 *     variables: [{
 *       name:    string,
 *       targets: [{ rnaPath: string }],
 *     }],
 *   }
 *
 * @module anim/driverPass
 */

import { evaluateDriver } from './driver.js';

/**
 * Walk the project and collect every driver-bound target. Returns a
 * list of `{ rnaPath, driver }` records ready to pass to
 * `evaluateDriver`. Pure read — doesn't mutate the project.
 *
 * # Sources scanned
 *
 *   - `project.parameters[i].driver` → rnaPath = `__params__['<id>']`
 *   - `project.nodes[i].transformDrivers[<field>]` → rnaPath
 *     `objects['<id>'].transform.<field>`
 *
 * @param {object} project
 * @returns {Array<{ rnaPath: string, driver: object }>}
 */
export function collectDrivers(project) {
  /** @type {Array<{ rnaPath: string, driver: object }>} */
  const out = [];
  if (!project) return out;
  if (Array.isArray(project.parameters)) {
    for (const p of project.parameters) {
      if (!p || typeof p.id !== 'string') continue;
      if (p.driver && typeof p.driver === 'object') {
        out.push({
          rnaPath: `objects['__params__'].values['${p.id}']`,
          driver: p.driver,
        });
      }
    }
  }
  if (Array.isArray(project.nodes)) {
    for (const n of project.nodes) {
      if (!n || typeof n.id !== 'string') continue;
      const td = n.transformDrivers;
      if (!td || typeof td !== 'object') continue;
      for (const field of Object.keys(td)) {
        const driver = td[field];
        if (!driver || typeof driver !== 'object') continue;
        out.push({
          rnaPath: `objects['${n.id}'].transform.${field}`,
          driver,
        });
      }
    }
  }
  return out;
}

/**
 * Run the driver pass over a project at the given time/values context.
 * Returns a `Map<rnaPath, value>` of all driver outputs that resolved
 * to a finite number. Errors in driver eval (e.g. a malformed scripted
 * expression) are swallowed — that driver's slot stays absent from the
 * output map and the caller falls back to the keyframe / static value.
 *
 * @param {object} project
 * @param {{ project?: object, currentValues?: object }} [evalContext]
 * @returns {Map<string, number>}
 */
export function evaluateProjectDrivers(project, evalContext = {}) {
  const ctx = { project, ...evalContext };
  const overrides = new Map();
  const drivers = collectDrivers(project);
  for (const { rnaPath, driver } of drivers) {
    try {
      const v = evaluateDriver(driver, ctx);
      if (Number.isFinite(v)) overrides.set(rnaPath, v);
    } catch {
      // Swallow per-driver errors so one bad driver doesn't poison the pass.
    }
  }
  return overrides;
}

/**
 * Convenience: extract just the param-id → value pairs from a driver
 * pass. Useful for chainEval which today maintains a flat
 * `Record<paramId, number>` value table — feeding driver overrides into
 * that table happens via this projection.
 *
 * @param {Map<string, number>} driverOverrides
 * @returns {Record<string, number>}
 */
export function driverOverridesToParamMap(driverOverrides) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!driverOverrides) return out;
  for (const [path, v] of driverOverrides) {
    const m = path.match(/^objects\['__params__'\]\.values\['([^']+)'\]$/);
    if (m) out[m[1]] = v;
  }
  return out;
}
