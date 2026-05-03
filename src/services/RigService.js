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
import { resetToRestPose, capturePose, restorePose } from './PoseService.js';
import { beginBatch, endBatch } from '../store/undoHistory.js';
import { logger } from '../lib/logger.js';

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

/**
 * V3 Re-Rig Phase 1 — canonical stage names. Order matches the seeder
 * order in `seedAllRig`. Used by `runStage` + RigStagesTab to dispatch.
 *
 * @typedef {'parameters'|'maskConfigs'|'physicsRules'|'boneConfig'|'variantFadeRules'|'eyeClosureConfig'|'rotationDeformerConfig'|'autoRigConfig'|'faceParallax'|'bodyWarpChain'|'rigWarps'} RigStageName
 */

/** @type {RigStageName[]} */
export const RIG_STAGE_NAMES = [
  'parameters',
  'maskConfigs',
  'physicsRules',
  'boneConfig',
  'variantFadeRules',
  'eyeClosureConfig',
  'rotationDeformerConfig',
  'autoRigConfig',
  'faceParallax',
  'bodyWarpChain',
  'rigWarps',
];

/** Stages 9-11 — keyform-bearing seeders that need a rest-pose harvest. */
const KEYFORM_STAGES = new Set(['faceParallax', 'bodyWarpChain', 'rigWarps']);

/**
 * Map stage name → projectStore action name. Most are 1:1; the
 * exception is `bodyWarpChain` (action is `seedBodyWarp` because
 * "Chain" was internal terminology when the action was named).
 *
 * @type {Record<RigStageName, string>}
 */
const STAGE_TO_ACTION = {
  parameters:             'seedParameters',
  maskConfigs:            'seedMaskConfigs',
  physicsRules:           'seedPhysicsRules',
  boneConfig:             'seedBoneConfig',
  variantFadeRules:       'seedVariantFadeRules',
  eyeClosureConfig:       'seedEyeClosureConfig',
  rotationDeformerConfig: 'seedRotationDeformerConfig',
  autoRigConfig:          'seedAutoRigConfig',
  faceParallax:           'seedFaceParallax',
  bodyWarpChain:          'seedBodyWarp',
  rigWarps:               'seedRigWarps',
};

// Single-flight lock for runStage (separate from initializeRig — both
// can race against each other but distinct guards let the UI distinguish).
let _runStageInFlight = false;

/**
 * V3 Re-Rig Phase 1 — refit a single rig stage.
 *
 * **Behaviour by stage class:**
 *
 *   - **Stages 1-8 (config-only):** read project state directly; no
 *     harvest required. Pose is preserved by default — no save/restore
 *     needed because seeders don't touch pose state.
 *
 *   - **Stages 9-11 (keyform-bearing):** require a harvest from a
 *     pristine rest pose so vertex positions snapshot correctly. Flow:
 *
 *         1. capturePose()           // snapshot live pose
 *         2. resetToRestPose()       // dial sliders + bone transforms = 0
 *         3. loadProjectTextures()   // PNG bytes for parabola fitting (eye stage)
 *         4. initializeRigFromProject() → harvest
 *         5. seedXxx(harvest.slot, mode)
 *         6. restorePose(snapshot)   // dials + bones back where the user had them
 *
 *     `paramValuesStore.resetToDefaults` is NOT called at the end —
 *     that's the destructive "Re-Init Rig" semantics, distinct from
 *     per-stage refit.
 *
 * **Mode:** defaults to `'merge'` (preserve `_userAuthored` entries on
 * conflict-surface fields). Pass `'replace'` to wipe + reseed.
 *
 * **Single-flight:** concurrent calls return early.
 *
 * **Telemetry:** writes `project.rigStageLastRunAt[stage]` on success.
 *
 * @param {RigStageName} stage
 * @param {{mode?: 'replace'|'merge'}} [opts={}]
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function runStage(stage, opts = {}) {
  if (!STAGE_TO_ACTION[stage]) {
    return { ok: false, error: `runStage: unknown stage "${stage}"` };
  }
  if (_runStageInFlight) {
    return { ok: false, error: 'rig stage refit already in flight' };
  }
  const pre = preflightBuildRig();
  if (!pre.ok) {
    return { ok: false, error: pre.reasons.join('; ') };
  }
  const mode = opts.mode ?? 'merge';
  _runStageInFlight = true;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  // beginBatch + endBatch fold the seeder commit and the telemetry stamp
  // into ONE undo entry — Ctrl+Z reverts both together (one click in =
  // one click out). Without this the user has to undo twice to fully
  // unwind a refit (timestamp, then data), which is confusing.
  beginBatch(useProjectStore.getState().project);
  try {
    if (KEYFORM_STAGES.has(stage)) {
      // Stages 9-11: rest-pose harvest required.
      const snapshot = capturePose();
      try {
        resetToRestPose();
        const project = useProjectStore.getState().project;
        let images = new Map();
        try { images = await loadProjectTextures(project); }
        catch (_err) { /* textures missing → fall back to mesh bin-max */ }
        const harvest = await initializeRigFromProject(project, images);
        const action = STAGE_TO_ACTION[stage];
        const store = useProjectStore.getState();
        // For each keyform stage: if harvest produced a value, seed it;
        // otherwise in REPLACE mode clear the stored value (mirrors the
        // `else if (mode === 'replace') clearXxx()` branches in
        // `seedAllRig`). MERGE mode preserves the existing stored value
        // when harvest is null — by design.
        if (stage === 'faceParallax') {
          if (harvest?.faceParallaxSpec) {
            store[action](harvest.faceParallaxSpec, mode);
          } else if (mode === 'replace') {
            store.clearFaceParallax();
          }
        } else if (stage === 'bodyWarpChain') {
          if (harvest?.bodyWarpChain) {
            store[action](harvest.bodyWarpChain, mode);
          } else if (mode === 'replace') {
            store.clearBodyWarp();
          }
        } else if (stage === 'rigWarps') {
          if (harvest?.rigWarps && harvest.rigWarps.size > 0) {
            store[action](harvest.rigWarps, mode);
          } else if (mode === 'replace') {
            store.clearRigWarps();
          }
        }
      } finally {
        // Always restore — even if seeding threw, the user's pose
        // survives.
        restorePose(snapshot);
      }
    } else {
      // Stages 1-8: direct seed call. Most accept (mode); some are
      // pure-defaults (parameters, boneConfig, variantFadeRules,
      // eyeClosureConfig, rotationDeformerConfig) and ignore extra args.
      const action = STAGE_TO_ACTION[stage];
      useProjectStore.getState()[action](mode);
    }

    // Stamp telemetry inside the same batch → folds into the seeder's
    // single undo snapshot. `skipHistory` would also work; batch is the
    // standard pattern and pairs with the begin/end calls above.
    const isoNow = new Date().toISOString();
    useProjectStore.getState().updateProject((p) => {
      if (!p.rigStageLastRunAt || typeof p.rigStageLastRunAt !== 'object') {
        p.rigStageLastRunAt = {};
      }
      p.rigStageLastRunAt[stage] = isoNow;
    });

    const dt = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    logger.info('rigStageRun', `runStage: ${stage} (${mode}) ${dt}ms`, { stage, mode, elapsedMs: dt });
    return { ok: true };
  } catch (err) {
    const error = /** @type {any} */ (err)?.message ?? String(err);
    if (typeof console !== 'undefined') console.error('[RigService] runStage failed:', stage, err);
    return { ok: false, error };
  } finally {
    endBatch();
    _runStageInFlight = false;
  }
}

/**
 * V3 Re-Rig Phase 1 — refit every stage in `seedAllRig` order with the
 * given mode. Default `'merge'` preserves user-authored entries; pass
 * `'replace'` for "Re-Init Rig" semantics (which already has its own
 * `initializeRig()` entry point — call that instead for full reset
 * including paramValues defaults reset).
 *
 * "Refit All" is structurally `runStage` for each name in
 * `RIG_STAGE_NAMES`, but we wrap it as a single immer transaction by
 * delegating to `seedAllRig(harvest, mode)` — same path the wizard
 * uses, plus pose save/restore around the keyform stages.
 *
 * @param {{mode?: 'replace'|'merge'}} [opts={}]
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function refitAll(opts = {}) {
  if (_runStageInFlight) {
    return { ok: false, error: 'rig stage refit already in flight' };
  }
  const pre = preflightBuildRig();
  if (!pre.ok) {
    return { ok: false, error: pre.reasons.join('; ') };
  }
  const mode = opts.mode ?? 'merge';
  _runStageInFlight = true;
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const snapshot = capturePose();
  // Single undo entry — see runStage for rationale.
  beginBatch(useProjectStore.getState().project);
  try {
    resetToRestPose();
    const project = useProjectStore.getState().project;
    let images = new Map();
    try { images = await loadProjectTextures(project); }
    catch (_err) { /* textures missing — proceed without */ }
    const harvest = await initializeRigFromProject(project, images);
    useProjectStore.getState().seedAllRig(harvest, mode);

    // Stamp every stage as run.
    const isoNow = new Date().toISOString();
    useProjectStore.getState().updateProject((p) => {
      if (!p.rigStageLastRunAt || typeof p.rigStageLastRunAt !== 'object') {
        p.rigStageLastRunAt = {};
      }
      for (const s of RIG_STAGE_NAMES) p.rigStageLastRunAt[s] = isoNow;
    });

    restorePose(snapshot);

    const dt = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0);
    logger.info('rigStageRun', `refitAll (${mode}) ${dt}ms`, { mode, elapsedMs: dt });
    return { ok: true };
  } catch (err) {
    // Best-effort restore even on failure.
    try { restorePose(snapshot); } catch (_e) { /* swallow */ }
    const error = /** @type {any} */ (err)?.message ?? String(err);
    if (typeof console !== 'undefined') console.error('[RigService] refitAll failed:', err);
    return { ok: false, error };
  } finally {
    endBatch();
    _runStageInFlight = false;
  }
}

/**
 * V3 Re-Rig Phase 1 — test-only helper. Resets the runStage single-flight
 * lock for unit tests.
 */
export function _resetRunStageInFlightForTest() {
  const was = _runStageInFlight;
  _runStageInFlight = false;
  return was;
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
