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
 * @returns {Promise<BuildRigResult>}
 */
export async function initializeRig() {
  const pre = preflightBuildRig();
  if (!pre.ok) {
    return { ok: false, error: pre.reasons.join('; '), rigSpec: null };
  }
  try {
    const project = useProjectStore.getState().project;
    const harvest = await initializeRigFromProject(project);

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
    // positions from a prior project.
    const paramsAfterSeed =
      harvest.rigSpec?.parameters ?? useProjectStore.getState().project.parameters ?? [];
    useParamValuesStore.getState().resetToDefaults(paramsAfterSeed);

    return { ok: true, rigSpec };
  } catch (err) {
    const error = /** @type {any} */ (err)?.message ?? String(err);
    if (typeof console !== 'undefined') console.error('[RigService] initializeRig failed:', err);
    return { ok: false, error, rigSpec: null };
  }
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
