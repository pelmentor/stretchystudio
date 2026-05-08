// @ts-check

import { coerceNumberArray } from '../../../../lib/numberArrayCoerce.js';

/**
 * V4 Phase 3a — Keyform grid layout helper.
 *
 * Pure function that decides how to lay out a deformer's keyforms in
 * the Properties panel based on the binding shape:
 *
 *   - 0 bindings: nothing to lay out (no params drive this deformer).
 *     Returns `{ kind: 'empty' }`.
 *   - 1 binding: 1D row. Cells indexed by `binding.keys[i]`.
 *   - 2 bindings: 2D matrix. Rows = binding[0].keys, cols = binding[1].keys.
 *     Cell at (r,c) maps to the keyform with `keyTuple = [keys0[r], keys1[c]]`.
 *   - N >= 3 bindings: flat list (current pre-Phase-3 behaviour). Phase 3
 *     polish may add axis-pinning UI; v1 falls back to "show every keyform
 *     as a row labelled with its keyTuple".
 *
 * Active-cell detection: given the live param values, an output cell is
 * marked active iff every binding's current value is epsilon-equal to
 * the cell's coordinate. Off-grid values produce no active cell.
 *
 * No JSX in this module — pure data only — so it tests cleanly under node.
 *
 * @module v3/editors/properties/sections/keyformGridLayout
 */

const EPS = 1e-6;

/**
 * @typedef {Object} Binding
 * @property {string} parameterId
 * @property {number[]} keys
 *
 * @typedef {Object} Keyform
 * @property {number[]} keyTuple
 * @property {*} [positions]   - warp keyform geometry
 * @property {number} [angle]  - rotation keyform angle
 * @property {number} [originX]
 * @property {number} [originY]
 *
 * @typedef {Object} GridCell
 * @property {number[]} keyTuple        - axis values for this cell
 * @property {Keyform|null} keyform     - matching keyform entry, or null if missing
 * @property {boolean} active           - true iff current param values land on this cell
 *
 * @typedef {{ kind: 'empty' }
 *   | { kind: '1d', binding: Binding, cells: GridCell[] }
 *   | { kind: '2d', bindingX: Binding, bindingY: Binding, rows: GridCell[][] }
 *   | { kind: 'flat', bindings: Binding[], cells: GridCell[] }
 * } GridLayout
 */

/**
 * Build the grid layout for a deformer's bindings + keyforms.
 *
 * @param {Binding[]|undefined|null} bindings
 * @param {Keyform[]|undefined|null} keyforms
 * @param {Record<string, number>|undefined|null} paramValues
 *   Map of `paramId → live value`. Used to mark the active cell.
 * @returns {GridLayout}
 */
export function buildKeyformGridLayout(bindings, keyforms, paramValues) {
  const binds = Array.isArray(bindings) ? bindings.filter(isBinding) : [];
  const kfs   = Array.isArray(keyforms) ? keyforms.filter((k) => Array.isArray(k?.keyTuple)) : [];
  const vals  = paramValues ?? {};

  if (binds.length === 0) {
    return { kind: 'empty' };
  }

  // Where on the active grid does the current param-value tuple land?
  // null if any binding is off-key.
  const activeKeyTuple = computeActiveKeyTuple(binds, vals);

  if (binds.length === 1) {
    const b = binds[0];
    const keys = coerceNumberArray(b.keys, `keyformGrid[${b.parameterId}].keys`);
    /** @type {GridCell[]} */
    const cells = keys.map((k) => {
      const matched = findKeyform(kfs, [k]);
      const isActive = activeKeyTuple !== null
        && activeKeyTuple.length === 1
        && approxEq(activeKeyTuple[0], k);
      return { keyTuple: [k], keyform: matched, active: isActive };
    });
    return { kind: '1d', binding: b, cells };
  }

  if (binds.length === 2) {
    const [bX, bY] = binds;
    const keysX = coerceNumberArray(bX.keys, `keyformGrid[${bX.parameterId}].keys`);
    const keysY = coerceNumberArray(bY.keys, `keyformGrid[${bY.parameterId}].keys`);
    /** @type {GridCell[][]} */
    const rows = keysY.map((ky) =>
      keysX.map((kx) => {
        const matched = findKeyform(kfs, [kx, ky]);
        const isActive = activeKeyTuple !== null
          && activeKeyTuple.length === 2
          && approxEq(activeKeyTuple[0], kx)
          && approxEq(activeKeyTuple[1], ky);
        return { keyTuple: [kx, ky], keyform: matched, active: isActive };
      })
    );
    return { kind: '2d', bindingX: bX, bindingY: bY, rows };
  }

  // N >= 3: flat list of every keyform.
  /** @type {GridCell[]} */
  const flat = kfs.map((kf) => {
    const isActive = activeKeyTuple !== null
      && Array.isArray(kf.keyTuple)
      && activeKeyTuple.length === kf.keyTuple.length
      && activeKeyTuple.every((v, i) => approxEq(v, kf.keyTuple[i]));
    return { keyTuple: kf.keyTuple.slice(), keyform: kf, active: isActive };
  });
  return { kind: 'flat', bindings: binds, cells: flat };
}

/**
 * Find the keyform in `keyforms` whose `keyTuple` matches `target`
 * exactly (epsilon comparison). Returns null if no match. Used both
 * by the grid layout and (later, Phase 3b) by the canvas overlay to
 * pick which keyform a click selects.
 *
 * @param {Keyform[]} keyforms
 * @param {number[]} target
 * @returns {Keyform|null}
 */
export function findKeyform(keyforms, target) {
  if (!Array.isArray(keyforms) || !Array.isArray(target)) return null;
  for (const kf of keyforms) {
    if (!Array.isArray(kf?.keyTuple) || kf.keyTuple.length !== target.length) continue;
    let ok = true;
    for (let i = 0; i < target.length; i++) {
      if (!approxEq(kf.keyTuple[i], target[i])) { ok = false; break; }
    }
    if (ok) return kf;
  }
  return null;
}

/**
 * If the current param values for every binding land exactly on a key
 * (epsilon-equal), return the corresponding key tuple. Otherwise null.
 *
 * @param {Binding[]} bindings
 * @param {Record<string, number>} paramValues
 * @returns {number[]|null}
 */
export function computeActiveKeyTuple(bindings, paramValues) {
  if (!Array.isArray(bindings) || bindings.length === 0) return null;
  const out = [];
  for (const b of bindings) {
    const cur = paramValues?.[b?.parameterId];
    if (typeof cur !== 'number' || !Number.isFinite(cur)) return null;
    const keys = coerceNumberArray(b.keys, `computeActiveKeyTuple[${b?.parameterId}].keys`);
    const hit = keys.find((k) => approxEq(k, cur));
    if (hit === undefined) return null;
    out.push(hit);
  }
  return out;
}

/**
 * Predicate guard for a usable binding entry.
 *
 * @param {any} b
 * @returns {b is Binding}
 */
function isBinding(b) {
  return b
    && typeof b.parameterId === 'string'
    && b.parameterId.length > 0
    && Array.isArray(b.keys);
}

/** Epsilon-equal for floats. */
function approxEq(a, b) {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return Math.abs(a - b) < EPS;
}
