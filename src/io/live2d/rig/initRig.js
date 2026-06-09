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

// GAP-008 `physicsRuleSubsystem` (name-prefix mapper) and the related
// `filterPhysicsRulesBySubsystems` filter were retired alongside the
// per-node physicsModifier port (v50, 2026-06-08). The subsystem opt-out
// now gates SEEDING by `rule.category` in `seedPhysicsModifiers` —
// `category` is a structured field set on every baseline rule, unlike
// the old name-prefix gate that silently no-op'd because baseline names
// like "Hair Front" never matched `startsWith('hair-')`.

/**
 * Filter a populated `rigSpec` into the four seedable shapes:
 *   - `faceParallaxSpec`: the single FaceParallax warp (or null).
 *   - `bodyWarpChain`: the full chain object stashed on rigCollector by
 *     cmo3writer (or null when the chain didn't build).
 *   - `rigWarps`: `partId → spec` map of per-mesh rig warps (those with
 *     `targetPartId` set; never includes face/body/neck).
 *   - `disabledTargetPartIds`: Set of partIds whose owning subsystem is
 *      flagged false in `subsystems`. The rigWarps are STILL included
 *      in the `rigWarps` map; consumers (seedRigWarps) write the modifier
 *      with `enabled: false` so the renderer's Blender-style modifier
 *      gate (`isModifierEnabled`) treats it as a rest-grid pass-through.
 *      This keeps the part visible at its authored position with no sway,
 *      instead of disappearing (empty `modifiers[]` → render at canvas
 *      origin — see [[rigInvariantCheck]] I-1 / I-21).
 *
 * Pure — exported so unit tests can exercise the filter logic without
 * spinning up the full export pipeline.
 *
 * **Subsystem opt-out semantics (revised 2026-06-08):**
 *   - `faceRig: false` → `faceParallaxSpec = null`, `neckWarpSpec = null`
 *   - `bodyWarps: false` → `bodyWarpChain = null`
 *   - `hairRig`/`clothingRig`/`eyeRig`/`mouthRig: false` → matching rigWarps
 *      are kept in `rigWarps` map but their partIds land in
 *      `disabledTargetPartIds`. `nodes` param is required for the tag
 *      lookup; pass `project.nodes` from the caller.
 *
 * Pre-revision (GAP-008) the harvest STRIPPED hair/clothing/eye/mouth
 * warps from the map. That left their part's `modifiers[]` empty after
 * seedRigWarps and produced I-1/I-21 "part renders at (1,1)" violations
 * because the renderer reads `part.modifiers[]` directly. PP1-002's
 * rigSpec-level neutralisation (`applySubsystemOptOutToRigSpec`, retired
 * 2026-06-08) was dead code post-chainEval-retirement (`146b716`) — the
 * depgraph chain walk starts from `part.modifiers[]`, not
 * `rigSpec.warpDeformers`. The disabled-Set flow makes the modifier-flag
 * the single source of truth, mirroring Blender's per-modifier toggle.
 *
 * @param {object} rigSpec
 * @param {{
 *   subsystems?: import('./autoRigConfig.js').AutoRigSubsystems,
 *   nodes?: Array<{id:string, name?:string}>,
 * }} [opts]
 * @returns {{
 *   faceParallaxSpec: object|null,
 *   bodyWarpChain: object|null,
 *   neckWarpSpec: object|null,
 *   rigWarps: Map<string, object>,
 *   disabledTargetPartIds: Set<string>,
 * }}
 */
export function harvestSeedFromRigSpec(rigSpec, opts = {}) {
  if (!rigSpec || !Array.isArray(rigSpec.warpDeformers)) {
    return {
      faceParallaxSpec: null,
      bodyWarpChain: null,
      neckWarpSpec: null,
      rigWarps: new Map(),
      disabledTargetPartIds: new Set(),
    };
  }

  const subs = opts.subsystems ?? null;
  // partId → tag map for the rigWarps filter. Built lazily, only when a
  // subsystem flag actually requires us to look up tags.
  const partIdToTag = subs && opts.nodes ? buildPartIdToTagMap(opts.nodes) : null;

  let faceParallaxSpec = null;
  let neckWarpSpec = null;
  const rigWarps = new Map();
  const disabledTargetPartIds = new Set();
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
      // Tag-based subsystem flag — unknown tags pass through (untagged
      // parts never disable). When the subsystem is OFF, we keep the
      // warp in the map but record the partId so seedRigWarps writes
      // the modifier with `enabled: false` (Blender modifier-toggle
      // parity). See doc comment above for the why.
      if (subs && partIdToTag) {
        const tag = partIdToTag.get(spec.targetPartId);
        const owningSubsystem = tag ? TAG_TO_SUBSYSTEM[tag] ?? null : null;
        if (owningSubsystem && subs[owningSubsystem] === false) {
          disabledTargetPartIds.add(spec.targetPartId);
        }
      }
      rigWarps.set(spec.targetPartId, spec);
    }
  }

  // GAP-008 — body warp chain opt-out.
  const bodyWarpChain = (subs && subs.bodyWarps === false)
    ? null
    : (rigSpec.bodyWarpChain ?? null);

  return { faceParallaxSpec, bodyWarpChain, neckWarpSpec, rigWarps, disabledTargetPartIds };
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
  // BUG-04 closure 2026-06-02 (rigInvariantCheck I-21 named source):
  // ALSO walk WARP parent chains. A rotation deformer can be reachable
  // ONLY via a warp's parent link when art meshes parent at the warp
  // (not directly at the rotation) — e.g. FaceParallax is parented at
  // FaceRotation, face-region art meshes parent at RigWarp_face which
  // is supposed to re-parent to FaceParallax but the re-parenting can
  // miss in some setups (handwear/bone-baked bug-03 fix path 2026-06-02).
  // With mesh-only walks, FaceRotation was marked orphan and dropped;
  // FaceParallax's lifted-grid eval then fell into gridLift's silent
  // fallback (treating pivot-relative coords as canvas-px), producing
  // 250k-px drift on 13 face-region parts. Walking WARP parents fixes
  // the reachability gap.
  //
  // NOTE: do NOT walk rotation parent chains. That would let orphan
  // rotations (Rotation_bothLegs → Rotation_root chain) keep their
  // own ancestor alive — defeats the prune purpose. Warps don't have
  // this problem because every warp on the rigSpec is either parented
  // at root (BodyXWarp) or downstream of a kept warp (RigWarp_<part>,
  // FaceParallax), so walking their parents only marks legit ancestors.
  for (const w of warps) walkChain(w?.parent);
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
/**
 * Decide whether `initializeRigFromProject` should use the authored
 * (cmo3-scene-backed) rig path or fall through to heuristic synthesis.
 *
 * The authored path is correct only when the imported scene's parts list
 * is still a superset of the project's current parts. If the user added
 * new layers (variant eyes like `irides-l.smile`, accessories, etc.)
 * since import, the authored path can't rig them — it reads the original
 * deformer graph and has no synthesis path for parts it doesn't know
 * about. Detect that case here so the caller can fall through to
 * `generateCmo3` (which DOES run all the variant-aware branches —
 * compound 2D blink × variant keyforms, per-part rig warps, variant
 * mask pairings).
 *
 * Pure function — no side effects, no logging. Caller decides whether
 * to warn (Init Rig does).
 *
 * @param {*} project
 * @returns {{
 *   use: boolean,
 *   reason: 'no-scene' | 'authored' | 'stale-scene',
 *   newPartNames: string[],
 *   firstNewPartVariant: string | null,
 * }}
 */
export function planAuthoredPath(project) {
  const sceneOk = !!(
    project?._cmo3Scene
    && Array.isArray(project._cmo3Scene.deformers)
    && project._cmo3Scene.deformers.length > 0
  );
  if (!sceneOk) {
    return { use: false, reason: 'no-scene', newPartNames: [], firstNewPartVariant: null };
  }
  const sceneNames = new Set();
  for (const p of project._cmo3Scene.parts ?? []) {
    if (p && typeof p.name === 'string' && p.name.length > 0) sceneNames.add(p.name);
  }
  /** @type {string[]} */
  const newPartNames = [];
  /** @type {string | null} */
  let firstNewPartVariant = null;
  for (const n of project.nodes ?? []) {
    if (!n || n.type !== 'part') continue;
    if (typeof n.name !== 'string' || n.name.length === 0) continue;
    if (sceneNames.has(n.name)) continue;
    newPartNames.push(n.name);
    if (firstNewPartVariant == null && typeof n.variantSuffix === 'string' && n.variantSuffix.length > 0) {
      firstNewPartVariant = n.variantSuffix;
    }
  }
  if (newPartNames.length > 0) {
    return { use: false, reason: 'stale-scene', newPartNames, firstNewPartVariant };
  }
  return { use: true, reason: 'authored', newPartNames: [], firstNewPartVariant: null };
}

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
  //
  // **Stale-scene guard:** if the project has parts that aren't in the
  // imported scene (user added new layers — variants, accessories, etc.
  // since the cmo3 import), the authored path can't rig them: it reads
  // the original deformer graph and has no synthesis for parts it doesn't
  // recognize. Detect new parts and fall through to heuristic synthesis
  // so the additions get proper per-part rig warps, compound 2D variant
  // keyforms, and mask pairings. The trade-off — heuristic synthesis
  // regenerates the WHOLE rig, possibly differing from the imported
  // values — is the right default for the "add layers + Init Rig" flow
  // because that's the user's explicit intent.
  const authoredPathPlan = planAuthoredPath(project);
  if (authoredPathPlan.reason === 'stale-scene') {
    logger.warn(
      'rigInit',
      `authored cmo3 scene is stale — ${authoredPathPlan.newPartNames.length} new part(s) added since import; falling through to heuristic synthesis so they get rigged properly`,
      {
        newPartCount: authoredPathPlan.newPartNames.length,
        newPartNames: authoredPathPlan.newPartNames.slice(0, 8),
        truncated: authoredPathPlan.newPartNames.length > 8,
        firstNewPartVariant: authoredPathPlan.firstNewPartVariant,
      },
    );
  }
  if (authoredPathPlan.use) {
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
      disabledTargetPartIds: new Set(),
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
    // RULE №4 Slice 2 audit-fix (MED-1 nuance): Init Rig is the
    // canonical re-fit moment for `project.eyeClosureParabolas` —
    // pass null (default) so `eyeClosureFit.js` runs fresh. The
    // resulting parabolas surface via `rigCollector.eyeClosureParabolas`
    // and `seedAllRig` mirrors them to `project.eyeClosureParabolas`
    // via `peers.seedEyeClosure`. Exporter (`exporter.js`) is the
    // ROUND-TRIP consumer; only it passes the stored data back in.
    // Adding `eyeClosure: resolveEyeClosure(project)` here would echo
    // stored data into the harvest and silently turn re-Init-Rig into
    // a no-op for eye-closure.
  }));

  const subsystems = resolveAutoRigConfig(project).subsystems ?? null;
  const { faceParallaxSpec, bodyWarpChain, neckWarpSpec, rigWarps, disabledTargetPartIds } = harvestSeedFromRigSpec(
    result.rigSpec,
    { subsystems, nodes: project.nodes ?? [] },
  );

  // Drop dead-end orphan rotation deformers (`Rotation_root`,
  // `Rotation_bothLegs`, etc. — see `pruneOrphanRotationDeformers`
  // doc) so their `ParamRotation_<g>` sliders disappear from the
  // Parameters panel instead of sitting dead.
  const pruned = pruneOrphanRotationDeformers(result.rigSpec);

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
    rigWarpsSeededDisabled: disabledTargetPartIds.size || undefined,
    droppedOrphanRotations: pruned.droppedRotationIds.length || undefined,
    droppedOrphanRotationIds: pruned.droppedRotationIds.length > 0 ? pruned.droppedRotationIds : undefined,
    droppedOrphanParams: pruned.droppedParamIds.length || undefined,
    droppedOrphanParamIds: pruned.droppedParamIds.length > 0 ? pruned.droppedParamIds : undefined,
    keptRotationIds: rs?.rotationDeformers?.map(/** @param {any} r */ (r) => r?.id).filter(Boolean) ?? undefined,
    warpsThatTargetRotations: rs?.warpDeformers
      ?.filter(/** @param {any} w */ (w) => w?.parent?.type === 'rotation')
      .map(/** @param {any} w */ (w) => `${w.id}->${w.parent.id}`)
      ?? undefined,
  }, 'Init Rig harvest complete');

  // PP2-005b identity-divergence diagnostic moved to
  // `RigService.initializeRig` (post-seedAllRig) as of 2026-06-03 — see
  // `rig/rigInitIdentityDiag.js`. The probe needs `project.nodes[]` to
  // carry the seeded modifier stacks before `evalProjectFrameViaDepgraph`
  // can produce non-empty frames; running it here (before seedAllRig)
  // silently emitted `partCount: 0` every Init Rig regardless of any
  // actual divergence.

  return {
    faceParallaxSpec,
    bodyWarpChain,
    neckWarpSpec,
    rigWarps,
    disabledTargetPartIds,
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
