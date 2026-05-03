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
import { matchTag } from '../../armatureOrganizer.js';
import { logger } from '../../../lib/logger.js';
import { buildRigSpecFromCmo3 } from './buildRigSpecFromCmo3.js';

const FACE_PARALLAX_WARP_ID = 'FaceParallaxWarp';
const BODY_WARP_IDS = new Set(['BodyZWarp', 'BodyYWarp', 'BreathWarp', 'BodyXWarp']);
const NECK_WARP_ID = 'NeckWarp';

/**
 * GAP-008 — tag → owning subsystem map. A rigWarp's `targetPartId`
 * resolves to a node, the node's name resolves via `matchTag` to a
 * canonical tag, and that tag picks which subsystem owns the warp.
 *
 * Tags listed under one subsystem are dropped when that subsystem flag
 * is `false`. Tags not listed pass through (unaffected by opt-out) —
 * defensive for unknown / future tags so opt-out can't accidentally
 * over-match.
 */
const TAG_TO_SUBSYSTEM = {
  // hairRig
  'front hair':     'hairRig',
  'back hair':      'hairRig',
  // clothingRig
  'topwear':        'clothingRig',
  'bottomwear':     'clothingRig',
  'legwear':        'clothingRig',
  // eyeRig
  'eyewhite':       'eyeRig',
  'eyewhite-l':     'eyeRig',
  'eyewhite-r':     'eyeRig',
  'eyelash':        'eyeRig',
  'eyelash-l':      'eyeRig',
  'eyelash-r':      'eyeRig',
  'irides':         'eyeRig',
  'irides-l':       'eyeRig',
  'irides-r':       'eyeRig',
  'eyebrow':        'eyeRig',
  'eyebrow-l':      'eyeRig',
  'eyebrow-r':      'eyeRig',
  // mouthRig
  'mouth':          'mouthRig',
};

/**
 * GAP-008 — physics-rule name → owning subsystem prefix-mapping. Rules
 * are named like `hair-front-1`, `clothing-skirt`, `arm-elbow-l`. The
 * first dash-segment selects the subsystem.
 */
function physicsRuleSubsystem(ruleName) {
  if (typeof ruleName !== 'string') return null;
  if (ruleName.startsWith('hair-')) return 'hairRig';
  if (ruleName.startsWith('clothing-') || ruleName.startsWith('skirt-')
      || ruleName.startsWith('shirt-') || ruleName.startsWith('pants-')) return 'clothingRig';
  if (ruleName.startsWith('arm-') || ruleName.includes('elbow')) return 'armPhysics';
  if (ruleName.startsWith('breath')) return 'bodyWarps';
  return null;
}

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
 * **GAP-008 subsystem opt-out:** when `subsystems` is provided, outputs
 * matching disabled subsystems are dropped:
 *   - `faceRig: false` → `faceParallaxSpec = null`
 *   - `bodyWarps: false` → `bodyWarpChain = null`
 *   - `hairRig`/`clothingRig`/`eyeRig`/`mouthRig: false` → `rigWarps`
 *      filtered by `nodeId → tag → TAG_TO_SUBSYSTEM` lookup. `nodes`
 *      param is required for this lookup; pass `project.nodes` from the
 *      caller.
 *
 * @param {object} rigSpec
 * @param {{
 *   subsystems?: import('./autoRigConfig.js').AutoRigSubsystems,
 *   nodes?: Array<{id:string, name?:string}>,
 * }} [opts]
 * @returns {{
 *   faceParallaxSpec: object|null,
 *   bodyWarpChain: object|null,
 *   rigWarps: Map<string, object>,
 * }}
 */
export function harvestSeedFromRigSpec(rigSpec, opts = {}) {
  if (!rigSpec || !Array.isArray(rigSpec.warpDeformers)) {
    return { faceParallaxSpec: null, bodyWarpChain: null, rigWarps: new Map() };
  }

  const subs = opts.subsystems ?? null;
  // partId → tag map for the rigWarps filter. Built lazily, only when a
  // subsystem flag actually requires us to look up tags.
  const partIdToTag = subs && opts.nodes ? buildPartIdToTagMap(opts.nodes) : null;

  let faceParallaxSpec = null;
  const rigWarps = new Map();
  for (const spec of rigSpec.warpDeformers) {
    if (!spec) continue;
    if (spec.id === FACE_PARALLAX_WARP_ID) {
      if (subs && subs.faceRig === false) continue;
      faceParallaxSpec = spec;
      continue;
    }
    if (BODY_WARP_IDS.has(spec.id)) continue;        // collected via bodyWarpChain
    if (spec.id === NECK_WARP_ID) continue;          // dropped (always part of body chain)
    if (typeof spec.targetPartId === 'string' && spec.targetPartId.length > 0) {
      // GAP-008 — tag-based subsystem filter. Unknown tags pass through.
      if (subs && partIdToTag) {
        const tag = partIdToTag.get(spec.targetPartId);
        const owningSubsystem = tag ? TAG_TO_SUBSYSTEM[tag] ?? null : null;
        if (owningSubsystem && subs[owningSubsystem] === false) continue;
      }
      rigWarps.set(spec.targetPartId, spec);
    }
  }

  // GAP-008 — body warp chain opt-out.
  const bodyWarpChain = (subs && subs.bodyWarps === false)
    ? null
    : (rigSpec.bodyWarpChain ?? null);

  return { faceParallaxSpec, bodyWarpChain, rigWarps };
}

/**
 * Build a `partId → tag` map from project nodes, using `matchTag` on
 * each node's name. Nodes without a recognised tag are omitted so the
 * caller's lookup returns undefined → "no subsystem ownership" → pass
 * through.
 *
 * @param {Array<{id:string, name?:string}>} nodes
 * @returns {Map<string, string>}
 */
function buildPartIdToTagMap(nodes) {
  const m = new Map();
  for (const n of nodes) {
    if (!n?.id) continue;
    const tag = matchTag(n.name ?? '');
    if (tag) m.set(n.id, tag);
  }
  return m;
}

/**
 * PP1-002 — drop subsystem-disabled rigWarps from a heuristic-path
 * rigSpec, mirroring what `buildRigSpecFromCmo3` does for the authored
 * path. The previously-shipped GAP-008 work filtered the seed-output
 * (project.rigWarps storage) but left `rigSpec.warpDeformers` intact —
 * which meant the live evaluator (chainEval) still applied disabled
 * subsystem warps, e.g. hair sway driven by ParamBodyAngle*. Filtering
 * the rigSpec itself fixes the partial opt-out.
 *
 * Algorithm:
 *   1. Walk warpDeformers; for each rigWarp with `targetPartId` whose
 *      tag maps to a disabled subsystem, queue it for drop.
 *   2. Drop those warps; reparent every artMesh / warp / rotation that
 *      pointed at one of them to the dropped warp's parent. Frame
 *      conversion is NOT redone — the verts are kept in their existing
 *      frame, which means the part renders at its rest pose under the
 *      new parent (no warp deformation applied to that mesh). This is
 *      the desired behaviour for opt-out: "show the part, don't deform".
 *
 * Pure: returns a new rigSpec, leaves the input untouched.
 *
 * @param {object} rigSpec
 * @param {{
 *   subsystems?: import('./autoRigConfig.js').AutoRigSubsystems|null,
 *   nodes?: Array<{id:string, name?:string}>,
 * }} [opts]
 * @returns {{rigSpec:object, droppedWarpIds:string[]}}
 */
export function applySubsystemOptOutToRigSpec(rigSpec, opts = {}) {
  if (!rigSpec || !Array.isArray(rigSpec.warpDeformers)) {
    return { rigSpec, droppedWarpIds: [] };
  }
  const subs = opts.subsystems ?? null;
  if (!subs) return { rigSpec, droppedWarpIds: [] };

  const partIdToTag = opts.nodes ? buildPartIdToTagMap(opts.nodes) : null;
  if (!partIdToTag) return { rigSpec, droppedWarpIds: [] };

  // Build warpId → parent map for reparent lookup.
  const warpById = new Map();
  for (const w of rigSpec.warpDeformers) {
    if (w?.id) warpById.set(w.id, w);
  }

  // 1. Identify warp ids to drop (per-part rigWarps owned by disabled subsystems).
  const droppedWarpIds = new Set();
  for (const spec of rigSpec.warpDeformers) {
    if (!spec) continue;
    if (typeof spec.targetPartId !== 'string' || spec.targetPartId.length === 0) continue;
    const tag = partIdToTag.get(spec.targetPartId);
    const owning = tag ? TAG_TO_SUBSYSTEM[tag] ?? null : null;
    if (owning && subs[owning] === false) droppedWarpIds.add(spec.id);
  }
  if (droppedWarpIds.size === 0) return { rigSpec, droppedWarpIds: [] };

  // 2. Resolve each dropped warp's effective surviving ancestor. If the
  //    parent is itself a dropped warp, walk up.
  function resolveSurvivingParent(parentRef) {
    let p = parentRef;
    while (p && p.type === 'warp' && droppedWarpIds.has(p.id)) {
      const w = warpById.get(p.id);
      p = w?.parent ?? { type: 'root', id: null };
    }
    return p ?? { type: 'root', id: null };
  }

  const filteredWarps = rigSpec.warpDeformers
    .filter(w => w && !droppedWarpIds.has(w.id));

  const reparentedArtMeshes = (rigSpec.artMeshes ?? []).map((m) => {
    if (!m?.parent || m.parent.type !== 'warp' || !droppedWarpIds.has(m.parent.id)) return m;
    return { ...m, parent: resolveSurvivingParent(m.parent) };
  });

  // Rotation deformers may also parent to a dropped warp — reparent them too.
  const reparentedRotations = (rigSpec.rotationDeformers ?? []).map((r) => {
    if (!r?.parent || r.parent.type !== 'warp' || !droppedWarpIds.has(r.parent.id)) return r;
    return { ...r, parent: resolveSurvivingParent(r.parent) };
  });

  return {
    rigSpec: {
      ...rigSpec,
      warpDeformers: filteredWarps,
      artMeshes: reparentedArtMeshes,
      rotationDeformers: reparentedRotations,
    },
    droppedWarpIds: [...droppedWarpIds],
  };
}

/**
 * Filter physics rules by subsystem opt-out flags. Rules whose name
 * matches a disabled subsystem prefix are dropped. Used by Init Rig
 * after seeding to prune `project.physicsRules` consistently with the
 * dropped rigWarps.
 *
 * @param {Array<{name?:string}>} rules
 * @param {import('./autoRigConfig.js').AutoRigSubsystems|null} subsystems
 * @returns {Array<{name?:string}>}
 */
export function filterPhysicsRulesBySubsystems(rules, subsystems) {
  if (!Array.isArray(rules) || !subsystems) return rules ?? [];
  return rules.filter((rule) => {
    const owning = physicsRuleSubsystem(rule?.name);
    if (!owning) return true;
    return subsystems[owning] !== false;
  });
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

  // **AUTHORED PATH** — projects loaded from cmo3 have the original rig
  // graph in `project._cmo3Scene`. Use `buildRigSpecFromCmo3` to assemble
  // a RigSpec directly from authored deformer data, bypassing the
  // heuristic body-warp / face-parallax / face-rotation synthesis. Per
  // docs/INIT_RIG_AUTHORED_REWRITE.md (closes the BUG-003 9.45 px
  // PARAM signal at AngleZ_pos30 by using the same rig values Cubism
  // does instead of regenerating them).
  if (project._cmo3Scene && Array.isArray(project._cmo3Scene.deformers) && project._cmo3Scene.deformers.length > 0) {
    const t0a = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const subsystems = resolveAutoRigConfig(project).subsystems ?? null;
    const { rigSpec, debug } = buildRigSpecFromCmo3({
      scene: project._cmo3Scene,
      project,
      meshes,
      canvasW: project.canvas?.width ?? 800,
      canvasH: project.canvas?.height ?? 600,
      subsystems,
    });
    const dta = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0a;
    const disabled = subsystems
      ? Object.entries(subsystems).filter(([, v]) => v === false).map(([k]) => k)
      : [];
    logger.info('rigInit', 'Init Rig authored-path complete', {
      elapsedMs: Math.round(dta),
      ...debug,
      disabledSubsystems: disabled.length > 0 ? disabled : undefined,
    });
    // The authored path doesn't (yet) produce a separate faceParallaxSpec /
    // bodyWarpChain harvest — those are export-pipeline concerns. The
    // rigSpec itself is consumed by chainEval directly.
    return {
      faceParallaxSpec: null,
      bodyWarpChain: null,
      rigWarps: new Map(),
      rigSpec,
      debug: { source: 'authored-cmo3', ...debug },
    };
  }

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

  const subsystems = resolveAutoRigConfig(project).subsystems ?? null;
  const { faceParallaxSpec, bodyWarpChain, rigWarps } = harvestSeedFromRigSpec(
    result.rigSpec,
    { subsystems, nodes: project.nodes ?? [] },
  );

  // PP1-002 — filter the live rigSpec itself so chainEval doesn't apply
  // disabled-subsystem rigWarps. Mirrors the authored-cmo3 path's drop +
  // reparent behaviour. Without this, `project.rigWarps` storage is filtered
  // (export-time) but `rigSpec.warpDeformers` still contains hair/clothing/eye
  // warps that get evaluated every frame, producing the visible "hair still
  // sways" symptom even when hairRig=false.
  const { rigSpec: filteredRigSpec, droppedWarpIds } = applySubsystemOptOutToRigSpec(
    result.rigSpec,
    { subsystems, nodes: project.nodes ?? [] },
  );

  const dt = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
  const rs = filteredRigSpec;
  // GAP-008 — log which subsystems are off so the user sees in the Logs
  // panel that the opt-out worked end-to-end.
  const disabled = subsystems
    ? Object.entries(subsystems).filter(([, v]) => v === false).map(([k]) => k)
    : [];
  logger.info('rigInit', 'Init Rig harvest complete', {
    elapsedMs: Math.round(dt),
    warpDeformers: rs?.warpDeformers?.length ?? 0,
    rotationDeformers: rs?.rotationDeformers?.length ?? 0,
    artMeshes: rs?.artMeshes?.length ?? 0,
    faceParallax: faceParallaxSpec ? 'present' : 'missing',
    bodyWarpChain: bodyWarpChain ? 'present' : 'missing',
    rigWarpsByPartId: rigWarps?.size ?? 0,
    disabledSubsystems: disabled.length > 0 ? disabled : undefined,
    optOutWarpsDroppedFromRigSpec: droppedWarpIds.length || undefined,
  });
  return {
    faceParallaxSpec,
    bodyWarpChain,
    rigWarps,
    rigSpec: filteredRigSpec ?? null,
    debug: result.rigDebugLog ?? null,
  };
}
