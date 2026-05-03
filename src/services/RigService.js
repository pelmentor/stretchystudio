// @ts-check

/**
 * v3 Phase 0B - RigService (Pillar F).
 *
 * Thin façade over `useRigSpecStore` + `initializeRigFromProject`.
 * Editors / operators talk to the service rather than reaching into
 * the store directly so:
 *
 *   1. Pre-flight checks (project has parts, has a canvas, etc.) live
 *      in one place rather than duplicated at every call site.
 *   2. Progress / error events have a single emit point - Phase 1's
 *      "Build Rig" toast / progress bar listens here.
 *   3. The store can change shape (rigSpecStore → rigStore + cache
 *      separation, etc.) without rippling out to editors.
 *
 * The service is a stateless module - it does not own state itself.
 * State lives in `useRigSpecStore`; the service is just verbs on top.
 *
 * @module services/RigService
 */

import { useRigSpecStore } from '../store/rigSpecStore.js';
import { useProjectStore } from '../store/projectStore.js';
import { useParamValuesStore } from '../store/paramValuesStore.js';
import { initializeRigFromProject } from '../io/live2d/rig/initRig.js';
import { resolvePhysicsRules } from '../io/live2d/rig/physicsConfig.js';
import { loadProjectTextures } from '../io/imageHelpers.js';
import { resetToRestPose } from './PoseService.js';

/**
 * @typedef {Object} BuildRigResult
 * @property {boolean} ok
 * @property {string} [error]
 * @property {object|null} rigSpec
 *
 * @typedef {Object} PreflightResult
 * @property {boolean} ok
 * @property {string[]} reasons          - non-empty when ok=false
 */

/**
 * Pure pre-flight: can we build a rig from this project? Pulled out
 * as a pure function so unit tests can call it without spinning up
 * a zustand store + the (heavy) projectStore import graph. The
 * convenience wrapper below reads from the live store.
 *
 * @param {object|null|undefined} project
 * @returns {PreflightResult}
 */
export function preflightBuildRigFor(project) {
  /** @type {string[]} */
  const reasons = [];
  if (!project) reasons.push('no project loaded');
  else {
    const partCount = (project.nodes ?? []).filter((n) => n?.type === 'part').length;
    if (partCount === 0) reasons.push('project has no part nodes');
    if (!project.canvas?.width || !project.canvas?.height) {
      reasons.push('project canvas has no dimensions');
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/**
 * Pre-flight: can we build a rig from the current project? Cheap
 * synchronous check used by Phase 1 UI to gate the Build button.
 *
 * @returns {PreflightResult}
 */
export function preflightBuildRig() {
  return preflightBuildRigFor(useProjectStore.getState().project);
}

/**
 * Trigger a rig build. Idempotent under buildRigSpec's single-flight
 * guard. Resolves with `{ok, rigSpec, error?}` rather than throwing
 * so callers don't need a try/catch around an operator.
 *
 * @returns {Promise<BuildRigResult>}
 */
export async function buildRig() {
  const pre = preflightBuildRig();
  if (!pre.ok) {
    return { ok: false, error: pre.reasons.join('; '), rigSpec: null };
  }
  const rigSpec = await useRigSpecStore.getState().buildRigSpec();
  if (!rigSpec) {
    const error = useRigSpecStore.getState().error ?? 'rig build returned no spec';
    return { ok: false, error, rigSpec: null };
  }
  return { ok: true, rigSpec };
}

// V3 Re-Rig Phase 0 — single-flight guard. The async window between
// `loadProjectTextures` (texture I/O) and `seedAllRig` (immer commit) is
// long enough that a rapid double-click on "Re-Init Rig" / "Initialize
// Rig" can run two harvests concurrently and write contradictory results
// — last writer wins, but the loser also fired UI side effects. Hold
// the lock for the whole `initializeRig` lifetime and release in finally.
let _initializeRigInFlight = false;

/**
 * Full "Initialize Rig" flow used by v3 ParametersEditor (and the
 * future `rig.initialize` operator). Distinct from `buildRig()` —
 * `buildRig` only computes + caches the rigSpec; `initializeRig`
 * additionally seeds the persisted keyform stores
 * (faceParallax / bodyWarp / rigWarps / configs) into projectStore
 * AND resets paramValues to fresh defaults. This is the destructive,
 * user-visible "make this PSD into a rig" action.
 *
 * Mirrors the v2 ParametersPanel runInit logic so behaviour stays
 * identical across shells. Eventually elevates to a Phase 5 operator
 * with confirm-modal gating; v3 first cut just wraps the same calls.
 *
 * **Single-flight (V3 Re-Rig Phase 0):** concurrent calls return early
 * with `{ ok: false, error: 'rig init already in flight' }`. The lock
 * is module-scope; it survives across React re-renders.
 *
 * @returns {Promise<BuildRigResult>}
 */
export async function initializeRig() {
  if (_initializeRigInFlight) {
    return { ok: false, error: 'rig init already in flight', rigSpec: null };
  }
  const pre = preflightBuildRig();
  if (!pre.ok) {
    return { ok: false, error: pre.reasons.join('; '), rigSpec: null };
  }
  _initializeRigInFlight = true;
  try {
    // BUG-004 / BUG-008 / BUG-010 — Init Rig is structurally a "rebuild
    // from rest pose" operation. Reset transient pose state BEFORE
    // harvesting so:
    //   - Bone groups have rotation=0 → skeleton overlay matches the
    //     rig's evalRig output (no armature-vs-mesh desync, BUG-004)
    //   - The rig builder sees pristine bone pivot positions instead
    //     of pivots offset by uncommitted bone-controller drags
    //     (BUG-008: layer "frozen" because rest verts absorbed the
    //     drag offset and the new chain doesn't have a deformer that
    //     drives it back)
    //   - Iris-related deformer keyforms are derived from rest iris
    //     positions, not whatever pose the user had when they clicked
    //     Init Rig (BUG-010: iris controller dies because new keyforms
    //     diverge from the controller's expected param→position map)
    //
    // Pose reset = clear draftPose + reset paramValues + zero every
    // bone-tagged group's transform (preserving pivots). Per-part
    // transforms (non-bone) are intentionally preserved — those are
    // user layout, not pose. See `services/PoseService.js`.
    resetToRestPose();
    const project = useProjectStore.getState().project;
    // Load textures so eye-source meshes get real PNG bytes for the
    // closure parabola fit. Failure here is non-fatal — rig init still
    // works without PNGs, just falls back to mesh bin-max sampling.
    let images = new Map();
    try {
      images = await loadProjectTextures(project);
    } catch (_err) { /* textures missing — proceed without */ }
    const harvest = await initializeRigFromProject(project, images);

    // Persist all rig outputs into projectStore.
    useProjectStore.getState().seedAllRig(harvest);

    // Cache the rigSpec for the live evaluator. Bypass buildRigSpec()
    // because it would re-run the harvest a second time. Also attach
    // physicsRules — same post-seed read the store does internally.
    let rigSpec = harvest.rigSpec ?? null;
    if (rigSpec) {
      const postSeedProject = useProjectStore.getState().project;
      rigSpec = { ...rigSpec, physicsRules: resolvePhysicsRules(postSeedProject) };
    }
    useRigSpecStore.setState({
      rigSpec,
      isBuilding: false,
      lastBuiltGeometryVersion:
        useProjectStore.getState().versionControl?.geometryVersion ?? 0,
      error: null,
    });

    // Seed live param values from the freshly baked param spec —
    // sliders start at canonical defaults rather than stale dial
    // positions from a prior project. `rigCollector.parameters` stays
    // `[]` by design (params live in `project.parameters`), so check
    // length explicitly — `?? project.parameters` would not fall back
    // on a truthy empty array and would wipe paramValues entirely,
    // leaving non-zero defaults like `ParamEyeLOpen=1` showing in the
    // slider (via ParamRow's default fallback) but missing from the
    // store, so the renderer reads `undefined` → 0 → eyes closed.
    const rigParams = harvest.rigSpec?.parameters;
    const paramsAfterSeed = (rigParams && rigParams.length > 0)
      ? rigParams
      : (useProjectStore.getState().project.parameters ?? []);
    useParamValuesStore.getState().resetToDefaults(paramsAfterSeed);

    return { ok: true, rigSpec };
  } catch (err) {
    const error = /** @type {any} */ (err)?.message ?? String(err);
    if (typeof console !== 'undefined') console.error('[RigService] initializeRig failed:', err);
    return { ok: false, error, rigSpec: null };
  } finally {
    _initializeRigInFlight = false;
  }
}

/**
 * V3 Re-Rig Phase 0 — test-only helper. Resets the single-flight lock
 * so unit tests can exercise the "second call returns early" path
 * without spinning up a real harvest. Not exported via the public API
 * surface in production code paths.
 *
 * @returns {boolean} true if a flight was in progress; false if already idle
 */
export function _resetInitializeRigInFlightForTest() {
  const wasInFlight = _initializeRigInFlight;
  _initializeRigInFlight = false;
  return wasInFlight;
}

/** Drop the cached rigSpec; next read re-builds. */
export function invalidateRig() {
  useRigSpecStore.getState().invalidate();
}

/** Current rigSpec or null. */
export function getRig() {
  return useRigSpecStore.getState().rigSpec;
}

/** True while a build is in flight. */
export function isBuilding() {
  return useRigSpecStore.getState().isBuilding;
}
