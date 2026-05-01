/**
 * Rig initialization orchestrator — Stage 1b.
 *
 * Bridges the heuristic rig builders (faceParallax, bodyWarp chain,
 * per-mesh rig warps) and the keyform-bearing project stores
 * (`project.faceParallax`, `project.bodyWarp`, `project.rigWarps`).
 *
 * Flow:
 *   1. Build the mesh array `generateCmo3` expects (no PNG data — `rigOnly`
 *      mode short-circuits before atlas packing so the placeholder
 *      Uint8Arrays from `buildMeshesForRig` are fine).
 *   2. Run `generateCmo3` in `rigOnly` mode with the keyform-bearing inputs
 *      explicitly set to `null` so the writer's inline heuristics fire and
 *      a fresh rigSpec is produced.
 *   3. Filter `rigSpec.warpDeformers` by id / `targetPartId` to peel out
 *      `faceParallaxSpec`, the body-warp chain, and the per-mesh rig-warp
 *      map. The chain object (with `layout` + `debug`) is stashed on the
 *      rigCollector by cmo3writer so we can hand it directly to
 *      `seedBodyWarpChain` without re-running `buildBodyWarpChain`.
 *
 * Caller (UI: v3 ParametersEditor "Initialize Rig" button → RigService.initializeRig) drains the result
 * into the project store via the seeder actions exposed on
 * `useProjectStore`. Failures during harvest leave seeders untouched —
 * the caller decides whether to seed partial results (e.g., when one
 * subsystem builds but another doesn't).
 *
 * **Staleness invariant.** Stage 1b doesn't track mesh signatures; calling
 * `initializeRigFromProject` after a PSD reimport overwrites the stored
 * keyforms with fresh ones, so re-init is always safe. Manual `clearXxx`
 * actions remain useful for users who want to revert to inline heuristics
 * without re-seeding.
 *
 * @module io/live2d/rig/initRig
 */

import { generateCmo3 } from '../cmo3writer.js';
import { buildMeshesForRig } from '../exporter.js';
import { resolveMaskConfigs } from './maskConfigs.js';
import { resolveBoneConfig } from './boneConfig.js';
import { resolveVariantFadeRules } from './variantFadeRules.js';
import { resolveEyeClosureConfig } from './eyeClosureConfig.js';
import { resolveRotationDeformerConfig } from './rotationDeformerConfig.js';
import { resolveAutoRigConfig } from './autoRigConfig.js';
import { logger } from '../../../lib/logger.js';

const FACE_PARALLAX_WARP_ID = 'FaceParallaxWarp';
const BODY_WARP_IDS = new Set(['BodyZWarp', 'BodyYWarp', 'BreathWarp', 'BodyXWarp']);
const NECK_WARP_ID = 'NeckWarp';

/**
 * Filter a populated `rigSpec` into the three seedable shapes:
 *   - `faceParallaxSpec`: the single FaceParallax warp (or null).
 *   - `bodyWarpChain`: the full chain object stashed on rigCollector by
 *     cmo3writer (or null when the chain didn't build).
 *   - `rigWarps`: `partId → spec` map of per-mesh rig warps (those with
 *     `targetPartId` set; never includes face/body/neck).
 *
 * Pure — exported so unit tests can exercise the filter logic without
 * spinning up the full export pipeline.
 *
 * @param {object} rigSpec
 * @returns {{
 *   faceParallaxSpec: object|null,
 *   bodyWarpChain: object|null,
 *   rigWarps: Map<string, object>,
 * }}
 */
export function harvestSeedFromRigSpec(rigSpec) {
  if (!rigSpec || !Array.isArray(rigSpec.warpDeformers)) {
    return { faceParallaxSpec: null, bodyWarpChain: null, rigWarps: new Map() };
  }

  let faceParallaxSpec = null;
  const rigWarps = new Map();
  for (const spec of rigSpec.warpDeformers) {
    if (!spec) continue;
    if (spec.id === FACE_PARALLAX_WARP_ID) {
      faceParallaxSpec = spec;
      continue;
    }
    if (BODY_WARP_IDS.has(spec.id)) continue;
    if (spec.id === NECK_WARP_ID) continue;
    if (typeof spec.targetPartId === 'string' && spec.targetPartId.length > 0) {
      rigWarps.set(spec.targetPartId, spec);
    }
  }

  const bodyWarpChain = rigSpec.bodyWarpChain ?? null;

  return { faceParallaxSpec, bodyWarpChain, rigWarps };
}

/**
 * Run the rig generator once against the live project state and harvest
 * the seedable specs from the produced rigSpec.
 *
 * Does NOT mutate `project`. Caller hands the result to the project
 * store's `seedAllRig` action (or individual seeders) to commit.
 *
 * **v2 R1.** Also returns the full `rigSpec` so the editor can cache it
 * (in `useRigSpecStore`) for the live evaluator. The seeder consumer
 * keeps using the harvest fields and ignores `rigSpec`; the runtime
 * cache uses `rigSpec` and ignores the harvest fields. Same one-shot
 * `generateCmo3 rigOnly` invocation drives both.
 *
 * @param {object} project
 * @param {Map<string, HTMLImageElement>} [images=new Map()]  unused but
 *   forwarded to `buildMeshesForRig` for parity with the export path
 * @returns {Promise<{
 *   faceParallaxSpec: object|null,
 *   bodyWarpChain: object|null,
 *   rigWarps: Map<string, object>,
 *   rigSpec: object|null,
 *   debug: object|null,
 * }>}
 */
export async function initializeRigFromProject(project, images = new Map()) {
  const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const partCount = (project.nodes ?? []).filter(n => n.type === 'part').length;
  const groupCount = (project.nodes ?? []).filter(n => n.type === 'group').length;
  const variantCount = (project.nodes ?? []).filter(n => n.type === 'part' && n.variantSuffix).length;
  logger.info('rigInit', 'Init Rig started', {
    parts: partCount,
    groups: groupCount,
    variants: variantCount,
    params: project.parameters?.length ?? 0,
    canvas: { w: project.canvas?.width, h: project.canvas?.height },
    imagesAttached: images?.size ?? 0,
  });

  const meshes = await buildMeshesForRig(project, images);
  const groups = (project.nodes ?? []).filter(n => n.type === 'group').map(g => ({
    id: g.id,
    name: g.name ?? g.id,
    parent: g.parent ?? null,
    boneRole: g.boneRole ?? null,
    transform: g.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  }));

  const result = await generateCmo3({
    canvasW: project.canvas?.width ?? 800,
    canvasH: project.canvas?.height ?? 600,
    meshes,
    groups,
    parameters: project.parameters ?? [],
    animations: [],
    modelName: 'init',
    generateRig: true,
    generatePhysics: false,
    rigOnly: true,
    maskConfigs: resolveMaskConfigs(project),
    bakedKeyformAngles: resolveBoneConfig(project).bakedKeyformAngles,
    variantFadeRules: resolveVariantFadeRules(project),
    eyeClosureConfig: resolveEyeClosureConfig(project),
    rotationDeformerConfig: resolveRotationDeformerConfig(project),
    autoRigConfig: resolveAutoRigConfig(project),
    // Pass null for the keyform-bearing inputs so the writer's inline
    // heuristics fire and the harvest sees fresh values rather than
    // echoing back what's already stored.
    faceParallaxSpec: null,
    bodyWarpChain: null,
    rigWarps: null,
  });

  const { faceParallaxSpec, bodyWarpChain, rigWarps } = harvestSeedFromRigSpec(result.rigSpec);
  const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const rs = result.rigSpec;
  logger.info('rigInit', 'Init Rig harvest complete', {
    elapsedMs: Math.round(dt),
    warpDeformers: rs?.warpDeformers?.length ?? 0,
    rotationDeformers: rs?.rotationDeformers?.length ?? 0,
    artMeshes: rs?.artMeshes?.length ?? 0,
    faceParallax: faceParallaxSpec ? 'present' : 'missing',
    bodyWarpChain: bodyWarpChain ? 'present' : 'missing',
    rigWarpsByPartId: rigWarps?.size ?? 0,
  });
  return {
    faceParallaxSpec,
    bodyWarpChain,
    rigWarps,
    rigSpec: result.rigSpec ?? null,
    debug: result.rigDebugLog ?? null,
  };
}
