// @ts-check

/**
 * v41 — Animation Phase 3 Slice 3.A: FCurve.modifiers[] substrate.
 *
 * Introduces the FModifier stack on every FCurve. Mirrors Blender's
 * `FCurve.modifiers: ListBaseT<FModifier>` at
 * `reference/blender/source/blender/makesdna/DNA_anim_types.h:353` (the
 * field; the surrounding `struct FCurve {` opens at `:341`). See
 * [src/anim/fmodifiers.js](../../anim/fmodifiers.js) for
 * the FModifier typedef + six per-type data shape typedefs
 * (`cycles` / `noise` / `generator` / `limits` / `stepped` / `envelope`).
 *
 * # Why a no-op migration (per Rule №2)
 *
 * `FCurve.modifiers` is a sparse field — every reader treats
 * missing-or-non-array as the empty list (see `getFCurveModifiers` at
 * [fmodifiers.js](../../anim/fmodifiers.js)). No existing project data
 * needs transformation because no FCurve previously carried a
 * `modifiers` array.
 *
 * The migration is registered as a version-bump marker so that
 *   1. CURRENT_SCHEMA_VERSION advances from 40 → 41 atomically with the
 *      typedef substrate landing.
 *   2. Saves written by v41-aware code carry `schemaVersion: 41` and
 *      down-level loads detect the version mismatch.
 *   3. The migration-walker's "ran every step" invariant holds without a
 *      gap in the version sequence.
 *
 * Rule №2 (no migration baggage) is satisfied because:
 *   - No no-op shims with RESERVED comments are introduced — the
 *     FModifier substrate is actively being shipped this phase
 *     (3.B evaluator next; 3.C UI; 3.D Cycles export; 3.E Noise).
 *   - No staged-but-not-registered migrations: this migration IS
 *     registered in `projectMigrations.js`.
 *   - No transition diagnostics for deferred-forever plans: Phase 3 is
 *     actively underway.
 *
 * # What v41 does NOT do
 *
 * It does NOT seed any modifier onto any FCurve. Pre-v41 projects load
 * with every FCurve.modifiers absent → reader sees empty list → eval
 * passes through unchanged. The evaluator landing in Slice 3.B preserves
 * this: an FCurve with no modifiers evaluates identically to its
 * pre-Phase-3 behaviour (keyframe sample → driver override → return).
 *
 * @module store/migrations/v41_fmodifiers
 */

/**
 * No-op marker migration. Walks `project.actions[*].fcurves[*]` only to
 * preserve the "scanner ran cleanly across the structure" sanity check
 * that the migration-walker's per-step telemetry implicitly relies on;
 * no field is read or written.
 *
 * @param {object} project -- mutated in place (no-op for v41 by design)
 */
export function migrateFModifiers(project) {
  if (!project || typeof project !== 'object') return;
  const actions = Array.isArray(project.actions) ? project.actions : [];
  for (const action of actions) {
    if (!action || !Array.isArray(action.fcurves)) continue;
    for (const fc of action.fcurves) {
      if (!fc) continue;
      // intentionally empty -- modifiers field is sparse-absent by default
    }
  }
}
