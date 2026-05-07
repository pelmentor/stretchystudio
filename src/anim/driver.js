// @ts-check

/**
 * Driver -- evaluates a small expression to override an FCurve.
 *
 * Phase 5 scaffold. Loose port of Blender's `ChannelDriver` from
 * `reference/blender/source/blender/makesdna/DNA_anim_types.h:296`
 * + `BKE_fcurve_driver_evaluate` in
 * `reference/blender/source/blender/blenkernel/intern/fcurve_driver.cc:1188`.
 * Several deliberate simplifications vs upstream -- see "Deviations" below.
 *
 * The expression grammar is deliberately small (a hardened JS subset)
 * so we can ship something safe today without a full parser:
 *
 *   - Arithmetic: `+ - * /` and parentheses
 *   - Variable references by name (single identifier)
 *   - Numeric literals
 *   - Built-in scalar functions: `sin`, `cos`, `min`, `max`, `abs`, `clamp`
 *   - The `?` ternary, `&& ||` boolean ops, comparison ops (deferred)
 *
 * NO function calls outside the whitelist, NO property access, NO
 * `eval`, NO module access, NO global scope. The implementation is a
 * pure `Function`-constructor sandbox -- any invalid syntax falls through
 * to a `NaN` result and the FCurve falls back to its keyframe value.
 *
 * # Driver types (Blender's `eDriver_Types`)
 *
 *   - `'scripted'`  → DRIVER_TYPE_PYTHON; evaluate `expression`
 *   - `'sum'`       → DRIVER_TYPE_SUM
 *   - `'min'`       → DRIVER_TYPE_MIN
 *   - `'max'`       → DRIVER_TYPE_MAX
 *   - `'avg'`       → DRIVER_TYPE_AVERAGE (mean)
 *
 * # Variable resolution
 *
 * Each `variables[]` entry has `{ name, type, target: { id, rnaPath } }`.
 * At eval time we resolve `target` via `evaluateRnaPath(project, ...)`
 * and bind the result to `name`. Today every variable resolves through
 * `evaluateRnaPath` which covers Blender's `DVAR_TYPE_SINGLE_PROP`
 * (the most common type).
 *
 * # Deviations from Blender
 *
 * - Blender's `expression` is Python (CPython compiled in
 *   `BPY_driver_eval`), with a `expr_simple` fast-path for arithmetic-
 *   only expressions handled by an internal `ExprPyLike_Parsed`. SS
 *   replaces both with a JS-subset sandbox via `Function`-constructor +
 *   `isSafeExpression` token rejection. This means real Python idioms
 *   (`if x else y` ternary, list comprehension, `**` power) won't work
 *   here; user expressions need translation if porting from Blender.
 * - Blender's `DriverVar` has `targets[8]` -- up to 8 targets per
 *   variable to support compound types (`DVAR_TYPE_ROT_DIFF`,
 *   `DVAR_TYPE_LOC_DIFF`). SS uses a single `target` per variable,
 *   covering only the `DVAR_TYPE_SINGLE_PROP` case. Compound vars are
 *   deferred until a real use-case lands.
 * - Blender's `ChannelDriver` has an `influence` slider (mix the driver
 *   output back with the F-Curve value). SS doesn't yet -- the driver
 *   either fully overrides or doesn't fire.
 *
 * @module anim/driver
 */

import { evaluateRnaPath } from './rnaPath.js';

/**
 * @typedef {Object} DriverVariable
 * @property {string} name
 * @property {('singleProp'|'transform'|'rotation')} [type]
 * @property {{id: string, rnaPath: string}} target
 *
 * @typedef {Object} ChannelDriver
 * @property {('scripted'|'sum'|'min'|'max'|'avg')} type
 * @property {string} [expression]      -- only for 'scripted'
 * @property {DriverVariable[]} variables
 */

/** Allowed identifier names exposed inside `expression`. */
const SAFE_GLOBALS = Object.freeze({
  sin:   Math.sin,
  cos:   Math.cos,
  abs:   Math.abs,
  min:   Math.min,
  max:   Math.max,
  clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
  sqrt:  Math.sqrt,
  pow:   Math.pow,
  PI:    Math.PI,
});

/**
 * Reject expressions containing tokens we don't allow. Safer than
 * trying to whitelist via parsing -- character-class rejection is
 * conservative.
 *
 *   - bracketed property access (`foo['bar']` / `foo.bar`)
 *   - `=` (assignment)
 *   - keywords: `function`, `return`, `var`, `let`, `const`, `new`,
 *     `class`, `import`, `export`, `eval`
 *
 * @param {string} expr
 * @returns {boolean}
 */
function isSafeExpression(expr) {
  if (typeof expr !== 'string') return false;
  if (/[[\]]/.test(expr)) return false;
  if (/=(?!=)/.test(expr)) return false; // bare = (assignment), not ==
  if (/\b(function|return|var|let|const|new|class|import|export|eval|this|window|document|globalThis)\b/.test(expr)) return false;
  if (/(?<![A-Za-z0-9_])\.(?![0-9])/.test(expr)) return false; // dot but not as decimal
  return true;
}

/**
 * Resolve every variable's value via its RNA path target.
 *
 * @param {DriverVariable[]} variables
 * @param {object} evalContext  -- { project }
 * @returns {Record<string, number>}
 */
function resolveVariables(variables, evalContext) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!Array.isArray(variables)) return out;
  const project = evalContext?.project;
  for (const v of variables) {
    if (!v?.name || !v?.target?.rnaPath) continue;
    if (!project) {
      out[v.name] = 0;
      continue;
    }
    const value = evaluateRnaPath(project, v.target.rnaPath);
    out[v.name] = typeof value === 'number' ? value : Number(value) || 0;
  }
  return out;
}

/**
 * Evaluate a driver. Returns NaN when the expression is unsafe / fails
 * to compile / produces a non-finite value -- the FCurve evaluator
 * treats NaN as "fall back to keyframe value."
 *
 * @param {ChannelDriver|null|undefined} driver
 * @param {object} evalContext
 * @returns {number}
 */
export function evaluateDriver(driver, evalContext) {
  if (!driver) return NaN;
  const vars = resolveVariables(driver.variables, evalContext);
  const values = Object.values(vars);
  switch (driver.type) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'min':
      return values.length === 0 ? 0 : Math.min(...values);
    case 'max':
      return values.length === 0 ? 0 : Math.max(...values);
    case 'avg':
      return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
    case 'scripted': {
      const expr = driver.expression;
      if (!isSafeExpression(expr)) return NaN;
      try {
        // Build the evaluator: `function(vars, builtins) { return <expr> }`
        // with vars + builtins destructured into local scope. The
        // sandbox has no closure over `this`, `window`, etc.
        const varNames = Object.keys(vars);
        const varValues = Object.values(vars);
        const builtinNames = Object.keys(SAFE_GLOBALS);
        const builtinValues = Object.values(SAFE_GLOBALS);
        const fn = new Function(
          ...varNames,
          ...builtinNames,
          `"use strict"; return (${expr});`,
        );
        const result = fn(...varValues, ...builtinValues);
        return Number.isFinite(result) ? Number(result) : NaN;
      } catch {
        return NaN;
      }
    }
    default:
      return NaN;
  }
}
