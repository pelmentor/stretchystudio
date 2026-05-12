// @ts-check

/**
 * Lazy seed-module loader for projectStore.
 *
 * Phase A2 loading sweep (2026-05-09). The 11 `seed*` modules
 * (paramSpec / maskConfigs / physicsConfig / boneConfig /
 * variantFadeRules / eyeClosureConfig / rotationDeformerConfig /
 * autoRigConfig / faceParallaxStore / bodyWarpStore / rigWarpsStore)
 * collectively weigh several hundred kB of source. Pre-fix they were
 * static imports in projectStore.js, dragged into the eager bundle
 * just because Topbar reads `hasUnsavedChanges` from the same module.
 *
 * Solution: dynamic import on first use. Every seed action in
 * projectStore awaits this loader before invoking. Memoised so the
 * second action call shares the resolved module.
 *
 * Production code paths that need seeds:
 *   - `seedAllRig(harvest)` — runs after Init Rig harvest (lazy via
 *     RigService → memoInitializeRigFromProject).
 *   - Individual `seed*` actions called from RigService.runStage
 *     (also already on the lazy initRig path).
 *
 * No production code path triggers a seed action before user
 * interaction with Init Rig / Refit, so the lazy load happens at the
 * exact moment the user expects "do work" — naturally serialised.
 *
 * @module store/projectStoreSeeds
 */

import { logger } from '../lib/logger.js';

/** @type {Promise<SeedModule> | null} */
let _seedsPromise = null;

/**
 * @typedef {Object} SeedModule
 * @property {(p: any, mode?: string) => void} seedParameters
 * @property {(p: any, mode?: string) => void} seedMaskConfigs
 * @property {(p: any, mode?: string) => void} seedPhysicsRules
 * @property {(p: any) => void} seedBoneConfig
 * @property {(p: any) => void} seedVariantFadeRules
 * @property {(p: any) => void} seedEyeClosureConfig
 * @property {(p: any) => void} seedRotationDeformerConfig
 * @property {(p: any, mode?: string) => void} seedAutoRigConfig
 * @property {(p: any, spec: any, mode?: string) => void} seedFaceParallax
 * @property {(p: any) => void} clearFaceParallax
 * @property {(p: any, chain: any, mode?: string) => void} seedBodyWarpChain
 * @property {(p: any) => void} clearBodyWarp
 * @property {(p: any, warps: any, mode?: string) => void} seedRigWarps
 * @property {(p: any) => void} clearRigWarps
 */

/**
 * Load all seed modules in parallel. Memoised — concurrent callers
 * share the same import promise.
 *
 * @returns {Promise<SeedModule>}
 */
export function loadSeedModule() {
  if (!_seedsPromise) {
    // First-call only — surfaces the import + module-eval cost of the
    // 11 seed modules. Subsequent calls share the resolved promise.
    logger.time('lazyLoad', 'seeds:11modules');
    _seedsPromise = Promise.all([
      import('../io/live2d/rig/paramSpec.js'),
      import('../io/live2d/rig/maskConfigs.js'),
      import('../io/live2d/rig/physicsConfig.js'),
      import('../io/live2d/rig/boneConfig.js'),
      import('../io/live2d/rig/variantFadeRules.js'),
      import('../io/live2d/rig/eyeClosureConfig.js'),
      import('../io/live2d/rig/rotationDeformerConfig.js'),
      import('../io/live2d/rig/autoRigConfig.js'),
      import('../io/live2d/rig/faceParallaxStore.js'),
      import('../io/live2d/rig/bodyWarpStore.js'),
      import('../io/live2d/rig/rigWarpsStore.js'),
    ]).then(([
      paramSpec, maskConfigs, physicsConfig, boneConfig,
      variantFadeRules, eyeClosureConfig, rotationDeformerConfig,
      autoRigConfig, faceParallaxStore, bodyWarpStore, rigWarpsStore,
    ]) => {
      logger.timeEnd('lazyLoad', 'seeds:11modules', { count: 11 });
      return {
        seedParameters: paramSpec.seedParameters,
        seedMaskConfigs: maskConfigs.seedMaskConfigs,
        seedPhysicsRules: physicsConfig.seedPhysicsRules,
        seedBoneConfig: boneConfig.seedBoneConfig,
        seedVariantFadeRules: variantFadeRules.seedVariantFadeRules,
        seedEyeClosureConfig: eyeClosureConfig.seedEyeClosureConfig,
        seedRotationDeformerConfig: rotationDeformerConfig.seedRotationDeformerConfig,
        seedAutoRigConfig: autoRigConfig.seedAutoRigConfig,
        seedFaceParallax: faceParallaxStore.seedFaceParallax,
        clearFaceParallax: faceParallaxStore.clearFaceParallax,
        seedBodyWarpChain: bodyWarpStore.seedBodyWarpChain,
        clearBodyWarp: bodyWarpStore.clearBodyWarp,
        seedRigWarps: rigWarpsStore.seedRigWarps,
        clearRigWarps: rigWarpsStore.clearRigWarps,
      };
    }).catch((err) => {
      // On import failure, also end the timer so we don't leak the registry
      // entry; the WARN from the next call's `time()` would mask the actual
      // failure cause.
      logger.timeEnd('lazyLoad', 'seeds:11modules', { error: err?.message ?? String(err) });
      _seedsPromise = null;
      throw err;
    });
  }
  return _seedsPromise;
}
