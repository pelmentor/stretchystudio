// @ts-check

/**
 * Animation Phase 7 Slice 7.C - live-value resolver for applyKeyingSet.
 *
 * Closes the MED-3 trap from Slice 7.B's audit: the default resolver
 * in `applyKeyingSet` calls `evaluateRnaPath(project, path)` which
 * returns `project.parameters[*].default` (STATIC) for `__params__`
 * paths, NOT the live runtime value from `paramValuesStore`. Any
 * call covering `__params__` paths needs a wrapper that reads the
 * live store first.
 *
 * This helper is the wrapper. UI integrators (7.C I-menu, 7.D auto-
 * key) build one per insert-key call site and pass it as
 * `options.resolveValue`.
 *
 * **Rule №1** -- explicit param-path regex; no silent fallthrough on
 * malformed `__params__` paths (caller's RNA grammar is the contract).
 *
 * Path grammar (mirror `keyingSets.js:204` emission):
 *
 *   `objects["__params__"].values["<id>"]` → live param value
 *
 *   Any other path → falls through to project-shape evaluator
 *
 * @module anim/insertKeyframeResolver
 */

import { evaluateRnaPath } from './rnaPath.js';

const PARAM_PATH_RE = /^objects\["__params__"\]\.values\["([^"]+)"\]$/;

/**
 * Build a resolver suitable for `applyKeyingSet(..., {resolveValue})`.
 *
 * @param {object} project        -- project draft / snapshot (whatever
 *                                   the apply call mutates / reads)
 * @param {Record<string, number>|null|undefined} paramValues
 *                                -- live `paramValuesStore.values`
 *                                   snapshot (`null` → falls through
 *                                   to default-resolver for every path,
 *                                   matching pre-7.C behaviour; useful
 *                                   for headless tests)
 * @returns {(rnaPath: string) => number | undefined}
 */
export function buildLiveResolver(project, paramValues) {
  return function resolveLive(rnaPath) {
    if (typeof rnaPath !== 'string' || rnaPath.length === 0) return undefined;
    if (paramValues) {
      const m = PARAM_PATH_RE.exec(rnaPath);
      if (m) {
        const id = m[1];
        const live = paramValues[id];
        if (typeof live === 'number' && Number.isFinite(live)) return live;
        // paramValuesStore lacks an entry for this id -- fall through
        // to evaluateRnaPath (which will return `project.parameters[*]
        // .default`). Matches v2 keyform-eval behaviour where missing
        // store entries silently default; Rule №1 -- this is not a
        // fallback (the path IS valid), it's the documented contract.
      }
    }
    return /** @type {number|undefined} */ (evaluateRnaPath(project, rnaPath));
  };
}
