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
import { evalRig } from '../runtime/evaluator/chainEval.js';
import { getBoneRole } from '../../../store/objectDataAccess.js';

const FACE_PARALLAX_WARP_ID = 'FaceParallaxWarp';
const BODY_WARP_IDS = new Set(['BodyWarpZ', 'BodyWarpY', 'BreathWarp', 'BodyXWarp']);
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
    return { faceParallaxSpec: null, bodyWarpChain: null, neckWarpSpec: null, rigWarps: new Map() };
  }

  const subs = opts.subsystems ?? null;
  // partId → tag map for the rigWarps filter. Built lazily, only when a
  // subsystem flag actually requires us to look up tags.
  const partIdToTag = subs && opts.nodes ? buildPartIdToTagMap(opts.nodes) : null;

  let faceParallaxSpec = null;
  let neckWarpSpec = null;
  const rigWarps = new Map();
  for (const spec of rigSpec.warpDeformers) {
    if (!spec) continue;
    if (spec.id === FACE_PARALLAX_WARP_ID) {
      if (subs && subs.faceRig === false) continue;
      faceParallaxSpec = spec;
      continue;
    }
    if (BODY_WARP_IDS.has(spec.id)) continue;        // collected via bodyWarpChain
    if (spec.id === NECK_WARP_ID) {
      // BFA-006 Phase 6 fallout — pre-Phase-6 the NeckWarp lived only
      // in the rigSpec and was never persisted (the comment here used
      // to say "always part of body chain", but it isn't a body chain
      // member; it sits between BodyXWarp and per-part rigWarps).
      // Post-Phase-6 every deformer must land in `project.nodes` or
      // its children orphan. Capture the spec so seedAllRig can
      // upsert it. Subsystem opt-out: tied to faceRig (NeckWarp is the
      // head-tilt warp).
      if (subs && subs.faceRig === false) continue;
      neckWarpSpec = spec;
      continue;
    }
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

  return { faceParallaxSpec, bodyWarpChain, neckWarpSpec, rigWarps };
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
 * PP1-002 — neutralise subsystem-disabled rigWarps in a heuristic-path
 * rigSpec. Previously-shipped GAP-008 work filtered the seed-output
 * (`project.rigWarps` storage) but left `rigSpec.warpDeformers` intact,
 * so the live evaluator (chainEval) still applied disabled-subsystem
 * warps and the user saw hair sway during body lean even with
 * `hairRig=false`.
 *
 * Algorithm: identify per-part rigWarps owned by disabled subsystems
 * (tag → TAG_TO_SUBSYSTEM lookup) and replace each one with an inert
 * pass-through:
 *   - `bindings: []`               — no params drive the warp.
 *   - `keyforms: [keyforms[0]]`    — only the rest grid survives.
 *
 * `cellSelect` with empty bindings returns the rest keyform with weight
 * 1 ([cellSelect.js:59](../runtime/evaluator/cellSelect.js#L59)), so the
 * warp evaluates to its rest grid every frame regardless of param
 * values. Bilinear FFD through that rest grid is identity within the
 * warp's bbox — input verts pass through to the parent's frame
 * unchanged. The art mesh stays at its rest canvas position with no
 * sway.
 *
 * Why neutralise instead of drop+reparent: dropping the warp would
 * orphan the art mesh's verts. The verts are stored in the dropped
 * warp's normalised 0..1 frame; reparenting to a different warp /
 * rotation / root would mismatch the frame and put the part at the
 * wrong location. Neutralising keeps the chain coord-correct.
 *
 * Pure: returns a new rigSpec, leaves the input untouched.
 *
 * @param {object} rigSpec
 * @param {{
 *   subsystems?: import('./autoRigConfig.js').AutoRigSubsystems|null,
 *   nodes?: Array<{id:string, name?:string}>,
 * }} [opts]
 * @returns {{rigSpec:object, neutralisedWarpIds:string[]}}
 */
export function applySubsystemOptOutToRigSpec(rigSpec, opts = {}) {
  if (!rigSpec || !Array.isArray(rigSpec.warpDeformers)) {
    return { rigSpec, neutralisedWarpIds: [] };
  }
  const subs = opts.subsystems ?? null;
  if (!subs) return { rigSpec, neutralisedWarpIds: [] };

  const partIdToTag = opts.nodes ? buildPartIdToTagMap(opts.nodes) : null;
  if (!partIdToTag) return { rigSpec, neutralisedWarpIds: [] };

  // Identify per-part rigWarps owned by disabled subsystems.
  const neutralised = new Set();
  for (const spec of rigSpec.warpDeformers) {
    if (!spec) continue;
    if (typeof spec.targetPartId !== 'string' || spec.targetPartId.length === 0) continue;
    const tag = partIdToTag.get(spec.targetPartId);
    const owning = tag ? TAG_TO_SUBSYSTEM[tag] ?? null : null;
    if (owning && subs[owning] === false) neutralised.add(spec.id);
  }
  if (neutralised.size === 0) return { rigSpec, neutralisedWarpIds: [] };

  const newWarps = rigSpec.warpDeformers.map((w) => {
    if (!w?.id || !neutralised.has(w.id)) return w;
    // BUG-022 — `w.keyforms[0]` is the FIRST keyform from the cartesian
    // product, not the REST keyform. For a hair warp bound to
    // `[ParamHairFront, keys: [-1, 0, 1]]`, perPartRigWarps emits keyforms
    // in order `keyTuple=[-1] / [0] / [1]` — `keyforms[0]` is the
    // swung-left grid. Picking it as the rest left disabled-subsystem
    // hair permanently tilted (15.5 px on shelby's front-hair / 12.2 px
    // on back-hair, per `rigInitIdentityDiag`).
    //
    // Pick the keyform whose keyTuple is all-zero (= rest of every
    // binding axis). Fall back to `keyforms[0]` for warps with non-
    // standard binding shapes (e.g. the `ParamOpacity[1.0]` no-op
    // single-keyform path) where no all-zero tuple exists.
    const kfs = Array.isArray(w.keyforms) ? w.keyforms : [];
    const restKf = kfs.find((k) =>
      Array.isArray(k?.keyTuple) && k.keyTuple.length > 0
        && k.keyTuple.every((v) => v === 0)
    ) ?? kfs[0] ?? null;
    return {
      ...w,
      bindings: [],
      keyforms: restKf ? [restKf] : [],
    };
  });

  return {
    rigSpec: { ...rigSpec, warpDeformers: newWarps },
    neutralisedWarpIds: [...neutralised],
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
 * Drop rotation deformers that nothing in the rig actually chains
 * through, plus their `ParamRotation_<group>` parameter entries.
 *
 * **Background.** The cmo3 generator emits one `GroupRotation_<g>` per
 * non-bone, non-skipped group + a matching `ParamRotation_<g>` param.
 * Whether anything ever drives through that rotation depends on where
 * downstream meshes / deformers parent at the end of `structuralChainEmit`
 * — and several configurations leave specific rotations as dead-end
 * orphans:
 *
 *   - `Rotation_root`: typical rigs re-parent every group rotation
 *     directly to BodyXWarp (line ~150-165 of structuralChainEmit), so
 *     `Rotation_root` ends up a sibling rather than an ancestor of the
 *     other rotations. The only descendant is whatever happens to have
 *     `parent.id === Rotation_root` after the immediate-ancestor walk
 *     in `rotationDeformerEmit:160-162`. For shelby, that's just
 *     `Rotation_bothLegs` — itself dead — so the chain dead-ends.
 *   - `Rotation_bothLegs`: `LEG_ROLES` skip in
 *     `structuralChainEmit:150-205` keeps it parented at root with no
 *     pivot conversion, AND every legwear mesh gets its own `RigWarp`
 *     re-parented to BodyXWarp (`structuralChainEmit:218`), so no
 *     mesh chain passes through `Rotation_bothLegs`.
 *   - `Rotation_leftArm`/`rightArm`: shelby's arms are bones with no
 *     mesh weights computed at PSD import (`childBoneRoleFor` only
 *     wires `arm → elbow` skinning when `node.mesh.boneWeights` exists,
 *     populated only at remesh time), so handwear meshes have no
 *     baked-keyform `ParamRotation_<arm>` bindings. The arm rotation
 *     deformer gets emitted but no mesh references it.
 *
 * The result: ghost sliders in the Parameters panel that the user
 * drags but nothing moves. Pruning them at harvest-time is the
 * smallest fix — the deformer chain isn't broken, it just hides
 * sliders that drive nothing.
 *
 * **Algorithm.** Walk every art mesh's parent chain and every other
 * deformer's parent chain. Mark every deformer id encountered.
 * Any rotation deformer NOT in the marked set is a dead-end orphan
 * — drop it from `rigSpec.rotationDeformers` and drop the matching
 * `ParamRotation_<id>` from `rigSpec.parameters`. (Identifying
 * `ParamRotation_<id>`: the rotation spec's `bindings[].parameterId`
 * — typically a single entry per rotation, but iterate to be safe.)
 *
 * Pure: returns a new rigSpec, leaves the input untouched.
 *
 * @param {object} rigSpec
 * @returns {{rigSpec: object, droppedRotationIds: string[], droppedParamIds: string[]}}
 */
export function pruneOrphanRotationDeformers(rigSpec) {
  if (!rigSpec) return { rigSpec, droppedRotationIds: [], droppedParamIds: [] };
  const rotations = Array.isArray(rigSpec.rotationDeformers) ? rigSpec.rotationDeformers : [];
  if (rotations.length === 0) return { rigSpec, droppedRotationIds: [], droppedParamIds: [] };

  const warps = Array.isArray(rigSpec.warpDeformers) ? rigSpec.warpDeformers : [];
  const meshes = Array.isArray(rigSpec.artMeshes) ? rigSpec.artMeshes : [];

  // Index for parent-chain walks. A deformer's parent ref is `{type, id}`;
  // we only care about the id when it points at another rotation/warp.
  /** @type {Map<string, {type: string, id: string|null}>} */
  const parentById = new Map();
  for (const w of warps) {
    if (w?.id && w.parent) parentById.set(w.id, w.parent);
  }
  for (const r of rotations) {
    if (r?.id && r.parent) parentById.set(r.id, r.parent);
  }

  const reachable = new Set();
  const walkChain = (parent) => {
    let cur = parent;
    let safety = 64;
    while (cur && cur.type !== 'root' && cur.id && safety-- > 0) {
      if (reachable.has(cur.id)) return; // already explored this branch
      reachable.add(cur.id);
      cur = parentById.get(cur.id) ?? null;
    }
  };

  for (const m of meshes) walkChain(m?.parent);

  // Rotation IDs whose parent chain is reachable from a mesh ARE alive.
  // Rotation IDs that are themselves an ancestor of an art mesh ARE alive
  // (covered by walkChain above). What's NOT alive: rotations that no
  // art mesh chain visits.
  const droppedRotationIds = [];
  const keptRotations = [];
  for (const r of rotations) {
    if (!r?.id) { keptRotations.push(r); continue; }
    if (reachable.has(r.id)) {
      keptRotations.push(r);
    } else {
      droppedRotationIds.push(r.id);
    }
  }
  if (droppedRotationIds.length === 0) {
    return { rigSpec, droppedRotationIds: [], droppedParamIds: [] };
  }

  // Identify param ids bound only by dropped rotations. A param is dead
  // if every binding referencing it lives on a dropped rotation. If any
  // surviving rotation / warp / art mesh still binds the param, KEEP it
  // (e.g. `ParamAngleZ` is bound by both FaceRotation [kept] and could
  // be bound by other deformers — never drop it).
  const droppedParamIdsCandidate = new Set();
  for (const r of rotations) {
    if (!r?.id || !droppedRotationIds.includes(r.id)) continue;
    for (const b of (r.bindings ?? [])) {
      if (b?.parameterId) droppedParamIdsCandidate.add(b.parameterId);
    }
  }
  if (droppedParamIdsCandidate.size === 0) {
    return {
      rigSpec: { ...rigSpec, rotationDeformers: keptRotations },
      droppedRotationIds,
      droppedParamIds: [],
    };
  }
  const survivingBindings = [];
  for (const r of keptRotations) {
    for (const b of (r?.bindings ?? [])) {
      if (b?.parameterId) survivingBindings.push(b.parameterId);
    }
  }
  for (const w of warps) {
    for (const b of (w?.bindings ?? [])) {
      if (b?.parameterId) survivingBindings.push(b.parameterId);
    }
  }
  for (const m of meshes) {
    for (const b of (m?.bindings ?? [])) {
      if (b?.parameterId) survivingBindings.push(b.parameterId);
    }
  }
  const survivingSet = new Set(survivingBindings);
  const droppedParamIds = [...droppedParamIdsCandidate].filter((id) => !survivingSet.has(id));

  let parameters = Array.isArray(rigSpec.parameters) ? rigSpec.parameters : [];
  if (droppedParamIds.length > 0) {
    const dropSet = new Set(droppedParamIds);
    parameters = parameters.filter((p) => !p?.id || !dropSet.has(p.id));
  }

  return {
    rigSpec: { ...rigSpec, rotationDeformers: keptRotations, parameters },
    droppedRotationIds,
    droppedParamIds,
  };
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
  logger.time('rigInit', 'full');
  // Outer try/catch ensures `rigInit:full` (and the conditional
  // `rigInit:authored-path`) cannot leak on throw — without this the next
  // Init Rig call would WARN "timer already running" AND its reported ms
  // would measure only the second invocation, silently invalidating
  // baselines on any failure path. Sub-timers wrapped via `logger.timed`
  // (`buildMeshes`, `heuristic-path-generateCmo3`) self-clean already.
  try {
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

  const meshes = await logger.timed('rigInit', 'buildMeshes', () => buildMeshesForRig(project, images));

  // **AUTHORED PATH** — projects loaded from cmo3 have the original rig
  // graph in `project._cmo3Scene`. Use `buildRigSpecFromCmo3` to assemble
  // a RigSpec directly from authored deformer data, bypassing the
  // heuristic body-warp / face-parallax / face-rotation synthesis. Per
  // docs/archive/plans-shipped/INIT_RIG_AUTHORED_REWRITE.md (closes the BUG-003 9.45 px
  // PARAM signal at AngleZ_pos30 by using the same rig values Cubism
  // does instead of regenerating them).
  if (project._cmo3Scene && Array.isArray(project._cmo3Scene.deformers) && project._cmo3Scene.deformers.length > 0) {
    logger.time('rigInit', 'authored-path');
    const subsystems = resolveAutoRigConfig(project).subsystems ?? null;
    const built = buildRigSpecFromCmo3({
      scene: project._cmo3Scene,
      project,
      meshes,
      canvasW: project.canvas?.width ?? 800,
      canvasH: project.canvas?.height ?? 600,
      subsystems,
    });
    const debug = built.debug;
    const pruned = pruneOrphanRotationDeformers(built.rigSpec);
    const rigSpec = pruned.rigSpec;
    const disabled = subsystems
      ? Object.entries(subsystems).filter(([, v]) => v === false).map(([k]) => k)
      : [];
    logger.timeEnd('rigInit', 'authored-path', {
      ...debug,
      disabledSubsystems: disabled.length > 0 ? disabled : undefined,
      droppedOrphanRotations: pruned.droppedRotationIds.length || undefined,
      droppedOrphanParams: pruned.droppedParamIds.length || undefined,
    }, 'Init Rig authored-path complete');
    // Close the outer timer too — authored-path is an early-return.
    logger.timeEnd('rigInit', 'full');
    // The authored path doesn't (yet) produce a separate faceParallaxSpec /
    // bodyWarpChain harvest — those are export-pipeline concerns. The
    // rigSpec itself is consumed by chainEval directly.
    return {
      faceParallaxSpec: null,
      bodyWarpChain: null,
      rigWarps: new Map(),
      rigSpec,
      droppedParamIds: pruned.droppedParamIds,
      debug: { source: 'authored-cmo3', ...debug, droppedOrphanRotations: pruned.droppedRotationIds, droppedOrphanParams: pruned.droppedParamIds },
    };
  }

  const groups = (project.nodes ?? []).filter(n => n.type === 'group').map(g => ({
    id: g.id,
    name: g.name ?? g.id,
    parent: g.parent ?? null,
    boneRole: getBoneRole(g),
    transform: g.transform ?? { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 },
  }));

  const result = await logger.timed('rigInit', 'heuristic-path-generateCmo3', () => generateCmo3({
    canvasW: project.canvas?.width ?? 800,
    canvasH: project.canvas?.height ?? 600,
    meshes,
    groups,
    parameters: project.parameters ?? [],
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
  }));

  const subsystems = resolveAutoRigConfig(project).subsystems ?? null;
  const { faceParallaxSpec, bodyWarpChain, neckWarpSpec, rigWarps } = harvestSeedFromRigSpec(
    result.rigSpec,
    { subsystems, nodes: project.nodes ?? [] },
  );

  // PP1-002 — neutralise disabled-subsystem rigWarps in the live rigSpec
  // so chainEval evaluates them as pass-throughs. Without this,
  // `project.rigWarps` storage is filtered (export-time) but
  // `rigSpec.warpDeformers` still contains hair/clothing/eye warps that
  // get evaluated every frame, producing the visible "hair still sways"
  // symptom even when hairRig=false.
  const { rigSpec: filteredRigSpec, neutralisedWarpIds } = applySubsystemOptOutToRigSpec(
    result.rigSpec,
    { subsystems, nodes: project.nodes ?? [] },
  );

  // Drop dead-end orphan rotation deformers (`Rotation_root`,
  // `Rotation_bothLegs`, etc. — see `pruneOrphanRotationDeformers`
  // doc) so their `ParamRotation_<g>` sliders disappear from the
  // Parameters panel instead of sitting dead.
  const pruned = pruneOrphanRotationDeformers(filteredRigSpec);

  const rs = pruned.rigSpec;
  // GAP-008 — log which subsystems are off so the user sees in the Logs
  // panel that the opt-out worked end-to-end.
  const disabled = subsystems
    ? Object.entries(subsystems).filter(([, v]) => v === false).map(([k]) => k)
    : [];
  logger.timeEnd('rigInit', 'full', {
    warpDeformers: rs?.warpDeformers?.length ?? 0,
    rotationDeformers: rs?.rotationDeformers?.length ?? 0,
    artMeshes: rs?.artMeshes?.length ?? 0,
    faceParallax: faceParallaxSpec ? 'present' : 'missing',
    bodyWarpChain: bodyWarpChain ? 'present' : 'missing',
    rigWarpsByPartId: rigWarps?.size ?? 0,
    disabledSubsystems: disabled.length > 0 ? disabled : undefined,
    optOutWarpsNeutralisedInRigSpec: neutralisedWarpIds.length || undefined,
    droppedOrphanRotations: pruned.droppedRotationIds.length || undefined,
    droppedOrphanParams: pruned.droppedParamIds.length || undefined,
  }, 'Init Rig harvest complete');

  // PP2-005b — identity-divergence diagnostic. The user's complaint is
  // that some parts visibly shift after Init Rig (hair sways/tilts
  // under no params, eyes drop, etc). Run evalRig once at default
  // params and compare each rig-driven art mesh's output vs its
  // `verticesCanvas` source. Anything > 1px is real divergence.
  // Logged per-part so the next user repro names the offender.
  // Originally gated on disabled subsystems; now runs unconditionally
  // so any visible rest-pose shift surfaces in the Logs panel without
  // having to toggle a subsystem first.
  if (rs && Array.isArray(rs.artMeshes) && rs.artMeshes.length > 0) {
    try {
      const frames = evalRig(rs, {});
      const meshById = new Map(rs.artMeshes.map((m) => [m.id, m]));
      /** @type {Array<{partId:string, name:string, maxDelta:number}>} */
      const offenders = [];
      let maxOverall = 0;
      for (const f of frames) {
        const meshSpec = meshById.get(f.id);
        const source = meshSpec?.verticesCanvas;
        if (!source || !f.vertexPositions) continue;
        const len = Math.min(source.length, f.vertexPositions.length);
        let partMax = 0;
        for (let i = 0; i < len; i++) {
          const d = Math.abs(source[i] - f.vertexPositions[i]);
          if (d > partMax) partMax = d;
        }
        if (partMax > maxOverall) maxOverall = partMax;
        if (partMax > 1.0) {
          offenders.push({ partId: f.id, name: meshSpec?.name ?? f.id, maxDelta: partMax });
        }
      }
      // Top 10 by delta — keeps the log readable on large rigs.
      offenders.sort((a, b) => b.maxDelta - a.maxDelta);
      const disabledNote = disabled.length > 0 ? ` (subsystems off: ${disabled.join(', ')})` : '';
      logger.info('rigInitIdentityDiag',
        `Init Rig rest-divergence${disabledNote}: max ${maxOverall.toFixed(2)} px across ${frames.length} parts; ${offenders.length} offenders > 1 px`,
        {
          disabledSubsystems: disabled.length > 0 ? disabled : undefined,
          maxOverallPx: Math.round(maxOverall * 100) / 100,
          partCount: frames.length,
          offenderCount: offenders.length,
          top10Offenders: offenders.slice(0, 10).map((o) => ({
            partId: o.partId, name: o.name, maxDeltaPx: Math.round(o.maxDelta * 100) / 100,
          })),
        });
    } catch (err) {
      // Non-fatal; instrumentation only.
      logger.warn('rigInitIdentityDiag', 'identity-divergence probe threw', { error: err?.message ?? String(err) });
    }
  }

  return {
    faceParallaxSpec,
    bodyWarpChain,
    neckWarpSpec,
    rigWarps,
    rigSpec: pruned.rigSpec ?? null,
    droppedParamIds: pruned.droppedParamIds,
    debug: result.rigDebugLog ?? null,
  };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.timeEndIfRunning('rigInit', 'authored-path', { error: errorMsg });
    logger.timeEndIfRunning('rigInit', 'full', { error: errorMsg });
    throw err;
  }
}
