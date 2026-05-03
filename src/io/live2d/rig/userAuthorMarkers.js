// @ts-check

/**
 * V3 Re-Rig Flow — Phase 0 — `_userAuthored` marker convention.
 *
 * Centralised module for distinguishing user-authored entries from
 * auto-seeded ones. Used by:
 *   - Manual-edit surfaces (MaskTab, physics3jsonImport, future warp UIs)
 *     to MARK the entries they create.
 *   - `merge` mode of conflict-surface seeders (maskConfigs, physicsRules,
 *     faceParallax, bodyWarp, rigWarps) to PRESERVE marked entries while
 *     reseeding the rest.
 *
 * **Why explicit markers, not heuristic detection.**
 * A heuristic ("does this auto-derive from current tags?") has edge
 * cases — a user-added mask that happens to align with a future tag
 * would silently lose its identity. Markers are explicit, diffable,
 * and survive renames + tag changes by design.
 *
 * **The marker.** A boolean field `_userAuthored: true` on the entry.
 * Absence (`undefined` / not-set) means auto-seeded — safe to reseed.
 * Storage cost is one boolean per marked entry; serialises to JSON
 * as part of the entry.
 *
 * **No migration needed.** Pre-Phase-0 saves have no markers; absence
 * is the safe default (everything reseedable). After Phase 0, manual
 * edits write markers going forward.
 *
 * Plan: docs/V3_RERIG_FLOW_PLAN.md → Phase 0.
 *
 * @module io/live2d/rig/userAuthorMarkers
 */

/**
 * Stamp `entry._userAuthored = true` on an entry. Idempotent.
 * Returns the entry for chaining.
 *
 * @template T
 * @param {T} entry
 * @returns {T}
 */
export function markUserAuthored(entry) {
  if (entry && typeof entry === 'object') {
    /** @type {any} */ (entry)._userAuthored = true;
  }
  return entry;
}

/**
 * Predicate: does this entry carry a `_userAuthored` marker?
 *
 * @param {any} entry
 * @returns {boolean}
 */
export function isUserAuthored(entry) {
  return !!(entry && typeof entry === 'object' && entry._userAuthored === true);
}

/**
 * Per-stage uniqueness keys. The merge helper uses these to decide
 * "is this auto-seeded entry already represented in `existing`?".
 *
 * Different stages have different identity semantics:
 *   - `maskConfigs`: `maskedMeshId` — one config per masked mesh.
 *   - `physicsRules`: `id` — Cubism rule ids are unique.
 *   - `faceParallax` / `bodyWarp`: scalar-stored — markers live on the
 *     stored object itself, not entries within. Resolution in seedFn.
 *   - `rigWarps`: keyed by `targetPartId` (already a map at storage
 *     time) — markers live per-partId entry.
 *
 * @type {Record<string, (entry: any) => string|null>}
 */
export const STAGE_KEY = Object.freeze({
  maskConfigs:  (e) => (e && typeof e.maskedMeshId === 'string') ? e.maskedMeshId : null,
  physicsRules: (e) => (e && typeof e.id === 'string') ? e.id : null,
  rigWarps:     (e) => (e && typeof e.targetPartId === 'string') ? e.targetPartId : null,
});

/**
 * Merge auto-seeded entries with existing entries, preserving any
 * existing user-authored ones.
 *
 * Strategy:
 *   1. Walk `existing`; keep every entry with `_userAuthored: true`.
 *   2. Walk `autoSeeded`; keep every entry whose key does NOT collide
 *      with a preserved user-authored entry's key.
 *
 * Order: user-authored entries appear first (as they were added by the
 * user; preserves stability across reseeds), then auto-seeded.
 *
 * **No markers in `existing`?** Nothing is preserved — output is just
 * `autoSeeded`. (Pre-Phase-0 projects load this way; safe.)
 *
 * @template T
 * @param {T[]} autoSeeded
 * @param {T[]|null|undefined} existing
 * @param {(entry:T) => string|null} keyOf - per-stage uniqueness key
 * @returns {T[]}
 */
export function mergeAuthored(autoSeeded, existing, keyOf) {
  if (!Array.isArray(existing) || existing.length === 0) {
    return autoSeeded.slice();
  }
  const preserved = [];
  const preservedKeys = new Set();
  for (const entry of existing) {
    if (!isUserAuthored(entry)) continue;
    preserved.push(entry);
    const k = keyOf(entry);
    if (k != null) preservedKeys.add(k);
  }
  if (preserved.length === 0) {
    return autoSeeded.slice();
  }
  const accepted = [];
  for (const entry of autoSeeded) {
    const k = keyOf(entry);
    if (k != null && preservedKeys.has(k)) continue;
    accepted.push(entry);
  }
  return [...preserved, ...accepted];
}

/**
 * Convenience wrapper: merge by stage name. Looks up the key function
 * from `STAGE_KEY`.
 *
 * @template T
 * @param {string} stageName
 * @param {T[]} autoSeeded
 * @param {T[]|null|undefined} existing
 * @returns {T[]}
 */
export function mergeAuthoredByStage(stageName, autoSeeded, existing) {
  const keyOf = STAGE_KEY[stageName];
  if (!keyOf) {
    throw new Error(`mergeAuthoredByStage: unknown stage "${stageName}"`);
  }
  return mergeAuthored(autoSeeded, existing, keyOf);
}

/**
 * Mode literal — `'replace'` (back-compat default) or `'merge'`
 * (preserves user-authored entries). Used as the second arg to
 * conflict-surface seeders + `seedAllRig`.
 *
 * @typedef {'replace'|'merge'} SeederMode
 */
