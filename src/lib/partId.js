/**
 * v3 Phase -1D — Canonical part-identifier convention.
 *
 * Background. Stretchy Studio uses three almost-but-not-quite identifiers
 * for parts that historically got conflated:
 *
 *   - `node.id` — primary key in `projectStore.project.nodes`. Created
 *     by `nanoid` / `uid()` at PSD import time, immutable for the
 *     lifetime of the part.
 *   - `partId` — name used on mesh records (`meshes[i].partId`),
 *     `ArtMeshSpec.id` in rigSpec, frames returned by `evalRig`. **It
 *     is the same string as `node.id`.** Different field name, same
 *     value.
 *   - `sanitizedName` — _derived_ identifier built by
 *     `(node.name || node.id).replace(/[^a-zA-Z0-9_]/g, '_')`. Used by
 *     `cmo3writer` to construct stable text-keyed deformer / parameter
 *     IDs that Cubism Editor will display (e.g. `RigWarp_Body_Front`,
 *     `ParamRotation_LeftArm`). **NOT a primary key** — collisions are
 *     possible if two nodes share a name. Treated as a string of XML
 *     content, not as a referenceable handle.
 *
 * Risk #6 from the v2 native-rig plan: code that assumed
 * `node.id == partId == sanitizedName` and silently dropped frames
 * when an ID lookup found nothing. The native rig pipeline made this
 * visible (chainEval keys frames by `meshSpec.id` = `partId` and
 * downstream code matches `node.id` — they MUST match).
 *
 * This module gives a single place to:
 *
 *   1. Document the typedef (`PartId` = `string & {__brand:'PartId'}`).
 *      Until we migrate to TypeScript (Phase 0D), the brand is a JSDoc
 *      annotation only — no runtime structural distinction.
 *   2. Provide runtime guards that catch the bug class loudly: empty
 *      strings, `null` / `undefined` / non-strings sneaking in, and
 *      cross-conversion mismatches.
 *
 * The full 24-site audit lives in `docs/V3_BLENDER_REFACTOR_PLAN.md`
 * Phase -1D / Pillar B; this module ships the runtime layer. Brand
 * enforcement at compile time is Phase 0D scope.
 *
 * @module lib/partId
 */

/**
 * Branded string alias for SS canonical part IDs. Same shape as
 * `node.id`, `meshes[i].partId`, and `ArtMeshSpec.id`. Brand only
 * exists in JSDoc / TS — at runtime it's just a string.
 *
 * @typedef {string & { readonly __brand: 'PartId' }} PartId
 */

/**
 * Runtime guard. Throws a labelled error if `value` is not a non-empty
 * string. Use at boundaries where an external system might hand us a
 * malformed ID (project file load, mesh worker results, third-party
 * import). Inside trusted internal code, prefer the cheaper `assert`
 * statement style — every guard adds a function call.
 *
 * @param {unknown} value
 * @param {string} [label='partId'] — used in the error message
 * @returns {PartId} — `value` cast to `PartId` (same string, branded)
 * @throws {TypeError} if `value` is missing, not a string, or empty
 */
export function assertPartId(value, label = 'partId') {
  if (typeof value !== 'string') {
    throw new TypeError(
      `${label} must be a string, got ${value === null ? 'null' : typeof value}`,
    );
  }
  if (value.length === 0) {
    throw new TypeError(`${label} must be non-empty`);
  }
  return /** @type {PartId} */ (value);
}

/**
 * Runtime guard for cross-source ID matching. Use at every place where
 * two layers of the system hand us "the same" partId via different
 * paths (e.g. evalRig frame's `frame.id` vs. lookup target
 * `node.id`). If they diverge, the bug is almost always a sanitisation
 * leak — `sanitizedName` accidentally used as a primary key.
 *
 * @param {string} a
 * @param {string} b
 * @param {string} [context] — optional human label for the error message
 * @throws {Error} if `a !== b`
 */
export function assertSamePartId(a, b, context = '') {
  if (a !== b) {
    const where = context ? ` (${context})` : '';
    throw new Error(`partId mismatch${where}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
  }
}

/**
 * Sanitise a part name into a Cubism-safe identifier fragment. This is
 * the **one official transform** that produces `sanitizedName`; every
 * other place in the codebase that constructs Cubism IDs from names
 * should call this rather than re-implementing the regex. The output
 * is **not** a primary key — only use it as part of derived strings
 * like `RigWarp_${sanitizedName}` or `ParamRotation_${sanitizedName}`.
 *
 * @param {string} name — node.name or fallback to node.id
 * @returns {string} — alphanumeric + underscore only
 */
export function sanitisePartName(name) {
  if (typeof name !== 'string' || name.length === 0) return '_';
  return name.replace(/[^a-zA-Z0-9_]/g, '_');
}
