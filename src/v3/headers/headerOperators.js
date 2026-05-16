// @ts-check

/**
 * F2-1 audit-fix sweep (ARCH-3) — shared header-operator dispatch.
 *
 * Pre-extract every area header (ViewportHeader / TimelineHeader /
 * DopesheetHeader / FCurveHeader) inlined byte-for-byte identical
 * `runOperator(opId)` + `isAvailable(opId)` helpers, differing only
 * in the `editorType` ctx string. Three copies + ViewportHeader's
 * inline pair = a same-pattern duplication that Rule №1 prohibits
 * (`feedback_no_crutches_rule_one.md`): if `getOperator`'s signature
 * changes or `available(ctx)` gains a new field, four files must
 * update in lockstep.
 *
 * Usage:
 *   const { runOperator, isAvailable } = makeHeaderOperators('viewport');
 *   <DropdownMenuItem
 *     disabled={!isAvailable('view.frameSelected')}
 *     onSelect={() => runOperator('view.frameSelected')}
 *   />
 *
 * Call once at module scope (outside the component body) so the
 * pair is stable across renders. The `editorType` flows into every
 * dispatch's context object — future header-scoped operators can
 * disambiguate by space (Blender's `bl_space_type` analog).
 *
 * @module v3/headers/headerOperators
 */

import { getOperator } from '../operators/registry.js';

/**
 * Bind the editor type once and return the (runOperator, isAvailable) pair.
 * @param {string} editorType - e.g. 'viewport' | 'timeline' | 'dopesheet' | 'fcurve'
 */
export function makeHeaderOperators(editorType) {
  const ctx = Object.freeze({ editorType });
  /** @param {string} opId */
  function runOperator(opId) {
    const op = getOperator(opId);
    if (!op) return false;
    if (op.available && !op.available(ctx)) return false;
    try {
      op.exec(ctx);
    } catch {
      // Operators log their own errors via logger.error — swallow
      // here so a thrown menu click doesn't crash the header.
    }
    return true;
  }
  /** @param {string} opId */
  function isAvailable(opId) {
    const op = getOperator(opId);
    if (!op) return false;
    if (!op.available) return true;
    return op.available(ctx);
  }
  return { runOperator, isAvailable };
}
