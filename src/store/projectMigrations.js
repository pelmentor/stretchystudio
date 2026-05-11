/**
 * Project schema migrations.
 *
 * Applied by `projectFile.loadProject()` immediately after parsing
 * `project.json` from a `.stretch` ZIP. Brings any older save up to
 * `CURRENT_SCHEMA_VERSION` so downstream code (projectStore, exporter)
 * can assume a single canonical shape.
 *
 * See `docs/archive/plans-shipped/NATIVE_RIG_REFACTOR.md` →
 * "Cross-cutting invariants → Schema versioning" for rationale.
 *
 * Adding a migration:
 *   1. Bump CURRENT_SCHEMA_VERSION.
 *   2. Add an entry to MIGRATIONS keyed by the new version number.
 *   3. The migration receives a project at version (newVersion - 1) and
 *      mutates / returns it at the new version. Don't bump
 *      project.schemaVersion inside the migration — `migrateProject`
 *      writes it after each step.
 *   4. Add a test in `scripts/test_migrations.mjs`.
 */

// CURRENT_SCHEMA_VERSION lives in `projectSchemaVersion.js` (tiny file,
// no peer imports) so projectStore can read the constant without
// dragging this whole migrations graph onto the eager path.
// Imported here for in-module use AND re-exported for back-compat.
import { CURRENT_SCHEMA_VERSION } from './projectSchemaVersion.js';
export { CURRENT_SCHEMA_VERSION };

import { synthesizeDeformerNodesFromSidetables, synthesizeModifierStacks } from './deformerNodeSync.js';
import { migrateModifierModeFlags } from './migrations/v21_modifier_mode_flags.js';
import { migrateEditModeSlotRename } from './migrations/v25_editmode_slot_rename.js';
import { migrateBlendShapeModeFold } from './migrations/v26_blendshape_mode_fold.js';
import { migrateSkeletonToPoseRename } from './migrations/v27_skeleton_to_pose_rename.js';
import { migrateModifierDataFold } from './migrations/v28_modifier_data_fold.js';
import { migrateArtMeshRuntimePersist } from './migrations/v29_artmesh_runtime_persist.js';
import { migrateStripRigidDefaultWeights } from './migrations/v32_strip_rigid_default_weights.js';
import { migrateProjectCursor } from './migrations/v33_project_cursor.js';
import { migrateWeightPaintSettings } from './migrations/v34_weight_paint_settings.js';
import { migratePoseShapeRepair } from './migrations/v35_pose_shape_repair.js';
import { migrateActionDatablock } from './migrations/v36_action_datablock.js';
import { migrateSceneAnimData } from './migrations/v37_scene_anim_data.js';
import { migrateNodeTreeRetirement } from './migrations/v38_nodetree_retirement.js';

// CURRENT_SCHEMA_VERSION re-exported above from `./projectSchemaVersion.js`
// — the constant lives there in a tiny side-effect-free file so eager
// importers can read it without pulling the migration graph.

/** Identity pose offset for a bone group. */
function identityPose() {
  return { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
}

const DEFAULT_CANVAS = () => ({
  width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff',
});

const MIGRATIONS = {
  // v1 — establishes the canonical defaults. Applied to any save that
  // lacked schemaVersion entirely (i.e. anything written before this
  // refactor). Replaces the scattered forward-compat patches that lived
  // in projectFile.loadProject and projectStore.loadProject.
  1: (project) => {
    project.canvas = { ...DEFAULT_CANVAS(), ...(project.canvas ?? {}) };
    if (!Array.isArray(project.textures)) project.textures = [];
    if (!Array.isArray(project.nodes)) project.nodes = [];
    if (!Array.isArray(project.animations)) project.animations = [];
    if (!Array.isArray(project.parameters)) project.parameters = [];
    if (!Array.isArray(project.physics_groups)) project.physics_groups = [];

    for (const node of project.nodes) {
      if (node.blendShapes === undefined) node.blendShapes = [];
      if (node.blendShapeValues === undefined) node.blendShapeValues = {};
    }

    for (const anim of project.animations) {
      if (!Array.isArray(anim.audioTracks)) anim.audioTracks = [];
      if (!Array.isArray(anim.tracks)) anim.tracks = [];
    }

    return project;
  },

  // v2 — Stage 3: project.maskConfigs is the native rig field for clip
  // mask pairings (iris↔eyewhite, variant-aware). Defaults to empty;
  // empty means the export pipeline runs today's heuristic. Populated
  // means the seeder has frozen the pairings on this project.
  2: (project) => {
    if (!Array.isArray(project.maskConfigs)) project.maskConfigs = [];
    return project;
  },

  // v3 — Stage 6: project.physicsRules is the native rig field for
  // physics simulations (hair sway, clothing, bust, arm pendulum).
  // Defaults to empty; empty means the export pipeline runs today's
  // hardcoded DEFAULT_PHYSICS_RULES with boneOutputs resolution.
  // Populated means the seeder has frozen rules into project state.
  3: (project) => {
    if (!Array.isArray(project.physicsRules)) project.physicsRules = [];
    return project;
  },

  // v4 — Stage 7: project.boneConfig.bakedKeyformAngles is the native
  // rig field for the bone rotation keyform angle set (default
  // [-90, -45, 0, 45, 90]). null/missing → resolver returns defaults.
  // Once populated, writers use the project-specific angle set.
  4: (project) => {
    if (project.boneConfig === undefined || project.boneConfig === null) {
      project.boneConfig = null;
    }
    return project;
  },

  // v5 — Stage 5: project.variantFadeRules + project.eyeClosureConfig.
  //   - variantFadeRules.backdropTags: tags exempt from base-fade when a
  //     variant sibling exists (face / ears / front+back hair).
  //   - eyeClosureConfig: tags + lashStripFrac + binCount that drive the
  //     parabola-fit closure system on eyelash/eyewhite/irides.
  // null/missing → resolvers return defaults.
  5: (project) => {
    if (project.variantFadeRules === undefined || project.variantFadeRules === null) {
      project.variantFadeRules = null;
    }
    if (project.eyeClosureConfig === undefined || project.eyeClosureConfig === null) {
      project.eyeClosureConfig = null;
    }
    return project;
  },

  // v6 — Stage 8: project.rotationDeformerConfig bundles the four
  // rotation-deformer auto-rig constants:
  //   - skipRotationRoles (boneRoles handled by warps, not rotation deformers)
  //   - paramAngleRange (ParamRotation_<group> min/max, default ±30)
  //   - groupRotation.{paramKeys, angles} (default 1:1 ±30)
  //   - faceRotation.{paramKeys, angles} (default ±10° angles for ±30 keys)
  // null/missing → resolver returns defaults.
  6: (project) => {
    if (project.rotationDeformerConfig === undefined || project.rotationDeformerConfig === null) {
      project.rotationDeformerConfig = null;
    }
    return project;
  },

  // v7 — Stage 2: project.autoRigConfig is the seeder tuning surface.
  // Three sections: bodyWarp (HIP/FEET fallbacks, BX/BY/Breath margins,
  // upper-body shape), faceParallax (depth coefficients, protection
  // per tag, super-groups, eye/squash amps), neckWarp (tilt fraction).
  // null/missing → resolver returns defaults for each section.
  7: (project) => {
    if (project.autoRigConfig === undefined || project.autoRigConfig === null) {
      project.autoRigConfig = null;
    }
    return project;
  },

  // v8 — Stage 4: project.faceParallax is the serialized FaceParallax
  // warp deformer spec — id, parent, gridSize, baseGrid (flat number[]),
  // bindings, keyforms (each with positions as flat number[]), opacity.
  // null/missing → resolver returns null and the cmo3 writer falls back
  // to its inline buildFaceParallaxSpec heuristic (today's path).
  // Populated → cmo3 writer skips the heuristic and serializes the
  // stored spec verbatim.
  8: (project) => {
    if (project.faceParallax === undefined || project.faceParallax === null) {
      project.faceParallax = null;
    }
    return project;
  },

  // v9 — Stage 10: project.bodyWarp is the serialized body warp chain
  // — array of 3 (no BX) or 4 (with BX) WarpDeformerSpec entries plus
  // the layout block (BZ_*, BY_*, BR_*, BX_*) and bodyFracSource debug.
  // null/missing → resolver returns null and the cmo3 writer falls back
  // to its inline buildBodyWarpChain heuristic (today's path).
  // Populated → cmo3 writer skips the heuristic and serializes the
  // stored chain verbatim, reconstructing canvasToBodyXX/Y closures
  // from the stored layout via makeBodyWarpNormalizers.
  9: (project) => {
    if (project.bodyWarp === undefined || project.bodyWarp === null) {
      project.bodyWarp = null;
    }
    return project;
  },

  // v10 — Stage 9b: project.rigWarps is the per-mesh rig warp keyform
  // store, keyed by partId. Each entry is a serialized WarpDeformerSpec
  // (id, parent, targetPartId, canvasBbox, gridSize, baseGrid as flat
  // number[], bindings, keyforms with positions as flat number[], opacity,
  // isVisible, isLocked, isQuadTransform). Empty {} means the cmo3 writer
  // runs today's inline shiftFn invocation per (mesh, keyform tuple).
  // Populated entries replace the shiftFn invocation with stored
  // positions — same v1 staleness footgun as Stages 4 and 10 (PSD reimport
  // with re-meshed silhouette requires `clearRigWarps`).
  10: (project) => {
    if (project.rigWarps === undefined || project.rigWarps === null) {
      project.rigWarps = {};
    }
    return project;
  },

  // v11 — Phase -1C: puppet warp removed. The IDW-based mesh deformer
  // (`src/mesh/puppetWarp.js`) and its UI surface (Inspector pin pad,
  // SkeletonOverlay pin handles, animation `puppet_pins` track) are
  // gone — the native rig (warp + rotation deformers) covers the same
  // ground in a Cubism-faithful way. Strip `puppetWarp` from any node
  // that still carries it, and drop `puppet_pins` tracks from
  // animations. Old saves load cleanly; pins are silently dropped.
  11: (project) => {
    for (const node of project.nodes ?? []) {
      if ('puppetWarp' in node) delete node.puppetWarp;
    }
    for (const anim of project.animations ?? []) {
      if (Array.isArray(anim.tracks)) {
        anim.tracks = anim.tracks.filter(t => t.property !== 'puppet_pins');
      }
    }
    return project;
  },

  // v12 — GAP-012 Phase A: project.meshSignatures captures a per-mesh
  // fingerprint (vertexCount, triCount, FNV-1a hash of UV bytes) at
  // seed time, recomputed at load + reimport. Detection-only — caller
  // (UI banner) decides on remediation. Empty {} → no validation runs;
  // populates on next seedAllRig. See docs/PROJECT_DATA_LAYER.md hole
  // I-1 + src/io/meshSignature.js. Old saves come through with empty
  // map; this is the "no Init Rig run yet OR pre-v12 build" case and
  // matches the unseededNew code path in validateProjectSignatures.
  12: (project) => {
    if (!project.meshSignatures || typeof project.meshSignatures !== 'object') {
      project.meshSignatures = {};
    }
    return project;
  },

  // v13 — Hole I-8: project.lastInitRigCompletedAt is the explicit
  // "Init Rig completed at this time" marker. Replaces the exporter's
  // old heuristic (`faceParallax/bodyWarp/rigWarps` presence). Legacy
  // saves come through with null; exporter's seeded-state check falls
  // through to the legacy heuristic when null, so existing rig data
  // still triggers seeded-mode export until the user re-runs Init Rig
  // (which sets the marker).
  13: (project) => {
    if (project.lastInitRigCompletedAt === undefined) {
      project.lastInitRigCompletedAt = null;
    }
    return project;
  },

  // v14 — V3 Re-Rig Phase 1: project.rigStageLastRunAt is the per-stage
  // freshness telemetry — `Record<stageName, ISO timestamp>` populated
  // by `RigService.runStage` and `RigService.refitAll`. Empty `{}` means
  // no per-stage refit has run yet (the "freshness" indicator in
  // RigStagesTab shows ⚪ never-run-since-init for entries missing this
  // marker). Coexists with `lastInitRigCompletedAt` — that field is the
  // "Re-Init Rig completed" marker, used by exporter for seeded-state
  // gating; rigStageLastRunAt is granular per-stage for the UI.
  14: (project) => {
    if (!project.rigStageLastRunAt || typeof project.rigStageLastRunAt !== 'object') {
      project.rigStageLastRunAt = {};
    }
    return project;
  },

  // v15 — BFA-006 Phase 1: lift the three persisted warp-deformer
  // sidetables (`project.faceParallax`, `project.bodyWarp.specs[]`,
  // `project.rigWarps[*]`) into first-class entries on `project.nodes`
  // carrying `type:'deformer', deformerKind:'warp'`. The sidetables
  // STAY populated for now — they remain the source of truth that
  // `cmo3writer` and `chainEval` read; the deformer nodes are SHADOW
  // DATA kept in sync via `seedFaceParallax` / `seedBodyWarpChain` /
  // `seedRigWarps` (and their `clearXxx` counterparts).
  //
  // Phases 2–6 strangle the sidetables progressively: Phase 2 reads
  // through a `selectRigSpec` derived selector over `project.nodes`,
  // Phase 3 makes auto-rig WRITE deformer nodes directly (sidetables
  // become dual-write shadows), Phase 6 deletes the sidetables.
  //
  // This migration is synchronous and idempotent: existing deformer
  // nodes with matching ids upsert in place rather than duplicate, and
  // it doesn't re-run Init Rig (the sidetable data is already
  // self-contained). Old fields are left in place so a Phase-1 rollback
  // is possible.
  //
  // See docs/archive/plans-shipped/BFA_006_DEFORMER_NODES.md.
  15: (project) => {
    synthesizeDeformerNodesFromSidetables(project);
    return project;
  },

  // v16 — BFA-006 Phase 6: deletion of the three legacy warp-deformer
  // sidetables (`project.faceParallax`, `project.bodyWarp`,
  // `project.rigWarps`). After this migration, `project.nodes` is the
  // sole runtime source of truth — sidetables are gone and all readers
  // (`resolveFaceParallax`, `resolveBodyWarp`, `resolveRigWarps`) now
  // walk `project.nodes` directly.
  //
  // Body warp metadata that doesn't fit on individual deformer nodes
  // (the `layout` block driving the canvas-px → innermost-warp 0..1
  // closures + the `bodyFracSource` debug record) splits off into
  // a tiny `project.bodyWarpLayout` sidetable. Migration shifts it
  // from the old `project.bodyWarp.{layout, debug}` to the new shape.
  //
  // Rollback to Phase 5 means restoring these fields from a Phase-5
  // save; that's a hard cutover, not a soft window. Phase 6 is gated
  // by the plan's Decision-4 soak window (≥1 week of daily-driver
  // use post-Phase-5 with no regressions).
  16: (project) => {
    if (project.bodyWarpLayout === undefined) project.bodyWarpLayout = null;
    // Lift the layout + debug from the legacy sidetable, IF it has
    // them. Run before deleting the sidetable so the lift is well-
    // formed; the v15 migration that runs first has already mirrored
    // the chain specs into `project.nodes` as deformer nodes, so
    // those don't need lifting again here.
    const legacy = project.bodyWarp;
    if (legacy && typeof legacy === 'object' && legacy.layout) {
      project.bodyWarpLayout = {
        layout: { ...legacy.layout },
        debug: legacy.debug ?? {},
      };
    }
    // Delete the three legacy sidetables. Idempotent: missing keys
    // are no-ops.
    delete project.faceParallax;
    delete project.bodyWarp;
    delete project.rigWarps;
    return project;
  },

  // v20 — Blender Parity Refactor Phase 3: per-Object modifier stack.
  //
  // Pre-v20 each part's modifier chain was an implicit walk through the
  // deformer-node tree: `part.rigParent` → `deformer.parent` → ... up
  // to root. That works at evaluation time but it's not the Blender
  // shape, where each Object carries an explicit ordered
  // `Object.modifiers[]` list (`ListBase<ModifierData>` in DNA).
  //
  // v20 derives the explicit per-part modifier stack as a forward-
  // compatible storage flip. Today's chainEval still walks the tree;
  // this migration just materialises the stack so:
  //   - future readers (modifier-stack UI, Cycles-style stack-evaluator)
  //     can iterate without re-walking
  //   - the data model matches Blender's per-Object stack convention
  //
  // Each modifier record on `part.modifiers[]` carries:
  //   - `type`: matches `deformer.deformerKind` ('warp' | 'rotation')
  //   - `deformerId`: pointer to the deformer node holding the actual data
  //   - `enabled`: true (Blender ModifierData has per-modifier disable;
  //     SS doesn't expose per-warp disable in the chain today, so this
  //     is reserved)
  //
  // Lossless and idempotent — derives from `part.rigParent` + deformer
  // parent links, replaces any prior `part.modifiers` value, drops the
  // field entirely when the stack would be empty (sparse JSON).
  20: (project) => {
    synthesizeModifierStacks(project);
    return project;
  },

  // v21 — Blender Parity V2 Phase 0.1: modifier mode flags + body-warp
  // fallback. Extends every modifier record with `{mode, enabled,
  // showInEditor}` per `DNA_modifier_types.h:131-144`, and writes a
  // synthetic body-warp modifier into every part that today rides the
  // body-warp chain implicitly (no `rigParent`). The synthetic insert
  // closes the gap that the V2 depgraph kernel (Phase D-3a) would
  // otherwise see — it iterates `Object.modifiers[]` and would silently
  // drop body-driven parts.
  //
  // See `src/store/migrations/v21_modifier_mode_flags.js` for the body
  // of the migration and the exact mode-bitmask values.
  21: (project) => {
    migrateModifierModeFlags(project);
    return project;
  },

  // v22 — RETIRED in v38. Used to lift `part.modifiers[]` into a
  // derived `RigTree` shadow on `project.nodeTrees.rig[partId]`. The
  // NodeTreeArea editor surface now derives the rig tree on-the-fly
  // via `buildRigTreeForPart(part)`; the persisted shadow is gone.
  // No-op shim — required by the migration walker's contiguous-version
  // invariant (mirrors the v30/v31 retirement pattern).
  //
  // See `src/store/migrations/v38_nodetree_retirement.js` for the
  // cleanup that strips `project.nodeTrees` from old saves.
  22: (project) => project,

  // v23 — RETIRED in v38. Used to lift `param.driver` into a derived
  // `DriverTree` shadow on `project.nodeTrees.driver[paramId]`. The
  // NodeTreeArea editor surface now derives the driver tree on-the-fly
  // via `compileDriverTree(paramId, driver)`; the persisted shadow is
  // gone. No-op shim.
  //
  // See `src/store/migrations/v38_nodetree_retirement.js`.
  23: (project) => project,

  // v24 — RETIRED in v38. Used to lift `project.animations[i]` (pre-v36
  // legacy clip shape) into a derived `AnimationTree` shadow on
  // `project.nodeTrees.animation[clipId]` via an inlined
  // `compileLegacyAnimationTree`. Post-v36 the actions/fcurves shape
  // is canonical; the NodeTreeArea editor surface now derives the
  // animation tree on-the-fly via `compileAnimationTree(action)`.
  // No-op shim.
  //
  // See `src/store/migrations/v38_nodetree_retirement.js`.
  24: (project) => project,

  // v25 — Blender Armature Alignment Phase 2: rename the editMode
  // slot value `'mesh'` → `'edit'` to match Blender's universal
  // `OB_MODE_EDIT` taxonomy. Rewrites any persisted `node.mode === 'mesh'`
  // (per-object mode storage from Phase 2b) to `'edit'`.
  //
  // See `src/store/migrations/v25_editmode_slot_rename.js`.
  25: (project) => {
    migrateEditModeSlotRename(project);
    return project;
  },

  // v26 — BLENDER_DEVIATION_AUDIT Fix 1: fold the legacy
  // `editMode === 'blendShape'` slot into Edit Mode + active-shape
  // pointer (Blender pattern). Rewrites stored `node.mode === 'blendShape'`
  // to `'edit'`.
  //
  // See `src/store/migrations/v26_blendshape_mode_fold.js`.
  26: (project) => {
    migrateBlendShapeModeFold(project);
    return project;
  },

  // v27 — BLENDER_DEVIATION_AUDIT Fix 2: rename the editMode slot
  // value `'skeleton'` → `'pose'` to match Blender's `OB_MODE_POSE`
  // taxonomy. Rewrites stored `node.mode === 'skeleton'` to `'pose'`.
  //
  // See `src/store/migrations/v27_skeleton_to_pose_rename.js`.
  27: (project) => {
    migrateSkeletonToPoseRename(project);
    return project;
  },

  // v28 — BLENDER_DEVIATION_AUDIT Fix 3 Phase 3.A: fold deformer-node
  // state INTO `Object.modifiers[i].data`. Each modifier entry gains
  // a `.data` sub-object copying the matching `node.type === 'deformer'`
  // fields. The deformer node itself stays for backward-compat (Phase
  // 3.B switches the export pipeline; Phase 3.C deletes the nodes).
  //
  // See `src/store/migrations/v28_modifier_data_fold.js`.
  28: (project) => {
    migrateModifierDataFold(project);
    return project;
  },

  // v29 — persist `rigSpec.artMeshes` runtime data (bindings + keyforms
  // + parent) into `project.nodes[i].mesh.runtime`. Pre-v29 the runtime
  // rigSpec rebuilt via `selectRigSpec(project)` lost per-art-mesh
  // bindings + keyforms (handwear bone-baked angles, eye-closure
  // curves, neck-corner offsets, variant fades) — they only existed
  // inside `generateCmo3.result.rigSpec` and were dropped on save+load
  // (and even immediately post Init Rig, when the auto-fill subscriber
  // overwrote the full rigSpec with the fast one).
  //
  // The migration clears `lastInitRigCompletedAt` so the next render
  // forces an async Init Rig that populates the new field via
  // `seedAllRig`'s persistence pass. User-authored deformer state on
  // the existing nodes is preserved by `seedAllRig`'s merge semantics.
  29: (project) => {
    migrateArtMeshRuntimePersist(project);
    return project;
  },

  // v30 — no-op shim. Required by the migration walker's
  // contiguous-version invariant.
  30: (project) => project,

  // v31 — RETIRED. Used to run `seedDefaultRigidWeights` (Cubism
  // Adapter Pattern Phase 1, anti-Blender). Reverted same day; v32
  // strips contamination from saves stamped at v31. v31 entry stays
  // as a no-op shim only because the migration walker insists on
  // contiguous version numbers — pre-v31 saves walk through
  // 30→31→32 in one load pass with v31 as a passthrough.
  31: (project) => project,

  // v32 — Cubism Adapter REVERT toward Blender parity. Strips the
  // rigid-1.0 vertex groups that v31 wrote onto parts that follow a
  // bone but don't need per-vertex skinning. Post-v32 those parts
  // render via the overlay-matrix path
  // (`pickBonePostChainComposition` returning `kind: 'overlay'`) —
  // same as Blender's "child of bone, no Armature modifier".
  //
  // Bone-routing intent (Audit Issue 8 — hand-only sub-meshes) is
  // preserved by the 4-arg `isRigidVertexGroup` predicate. Truly
  // skinned limb meshes (variable per-vertex weights from
  // `computeSkinWeights`) keep their weights.
  //
  // See `docs/plans/CUBISM_ADAPTER_REVERT_BLENDER_PARITY.md`.
  32: (project) => {
    migrateStripRigidDefaultWeights(project);
    return project;
  },

  // v33 — Toolset Plan Phase 7.A.1 — `project.cursor: {x, y}` (canvas-
  // space 3D-cursor analog for the Snap menu, Blender's
  // `Scene.cursor.location` per `DNA_scene_types.h:2300`). Default =
  // canvas centre. Persisted per-project so save+load preserves cursor
  // position (a pointless menu otherwise — every save would reset it).
  33: (project) => {
    migrateProjectCursor(project);
    return project;
  },

  // v34 — Toolset Plan Phase 7.B.4 — `node.weightPaintSettings: { xMirror }`
  // for every part. Per-Object X-axis live mirror toggle for weight paint
  // strokes. Blender stores the equivalent on `Mesh.symmetry & ME_SYMMETRY_X`
  // per `reference/blender/source/blender/makesrna/intern/rna_mesh.cc:3243-3247`.
  // Default `false` so pre-v34 projects open with the toggle off (today's
  // behaviour). User opts in per-part via the N-panel toggle.
  34: (project) => {
    migrateWeightPaintSettings(project);
    return project;
  },

  // v35 — Pose Read/Write Canonicalisation Plan audit-fix D-3 — repair
  // mixed-state pose corruption introduced by pre-Phase-8 writers.
  //
  // # The corruption
  //
  // Phase 8 routed every writer through `setBonePose`/`setBonePoseField`
  // helpers that detect v17/v18 flat shape vs v19+ channels shape and
  // write into the correct slot. Pre-Phase-8 writers (specifically the
  // depgraph kernels `bonePostChain.js` + `transformCompose.js` reached
  // via Phase 0.D.0's `c8f86f3` rAF wiring, and `rnaPath.setRnaPath`
  // for FCurve / driver writes) wrote flat fields onto the channels
  // envelope WITHOUT updating the inner channel:
  //
  //     // Pre-Phase-8 corrupt write:
  //     node.pose = { channels: { 'b1': {rotation: 0.5} } };  // v19 shape
  //     node.pose.rotation = 1.2;                              // bad write
  //     // Result: { rotation: 1.2, channels: { 'b1': {rotation: 0.5} } }
  //
  // `getBonePose` reads `channels[node.id].rotation = 0.5` (the STALE
  // value), and the user's actual pose (1.2) is shown only via the
  // direct flat-field reads that Phase 8 audit just removed. Net effect
  // for the user: composed transforms silently drop on every load.
  //
  // The v19 migration's idempotency guard (`!flatPose.channels`)
  // PERMANENTLY locks corrupt mixed-state bones in unreadable form —
  // re-running v19 on a corrupted project skips them. Without v35,
  // there's no recovery path.
  //
  // # The repair
  //
  // For every bone-group node whose `pose` has BOTH `channels` AND any
  // flat pose field (`rotation`/`x`/`y`/`scaleX`/`scaleY`):
  //   1. Move flat fields INTO `channels[node.id]` (latest-wins
  //      semantics — the flat field is the value the post-corruption
  //      writer intended; the stale channels value pre-dates that).
  //   2. Delete the flat fields from `node.pose`, leaving only the
  //      `channels` envelope intact.
  //
  // Lossless-by-design: bones with PURE channels-shape OR PURE flat
  // shape are untouched. Only the mixed-state bones get repaired.
  //
  // Idempotent: post-repair `node.pose` has either {channels} OR
  // {rotation, x, y, ...} — never both. Re-running v35 on a v35+
  // project is a no-op.
  //
  // # Why a migration vs. shell-only fix
  //
  // The Phase 8 helpers prevent FUTURE corruption, but cannot detect
  // PAST corruption: by the time `getBonePose` reads the mixed-state
  // bone, the stale value is the only authoritative one in the
  // codebase. The flat field is data corruption that's impossible to
  // distinguish from "user wrote this just now" without timestamp
  // metadata. We trust the flat field as latest-write because that's
  // what every pre-Phase-8 writer intended to commit.
  35: (project) => {
    migratePoseShapeRepair(project);
    return project;
  },

  // v36 — Animation Phase 1 Stage 1.A + 1.B: `Action` datablock + per-
  // Object `AnimData` from legacy `project.animations[]`. Splits the
  // pre-v36 flat animations list into:
  //   - `project.actions[i]` (Blender Action datablock — fcurves +
  //     metadata + audioTracks); fcurves carry rnaPath strings instead of
  //     paramId/nodeId/property fields.
  //   - `node.animData` per Object (parts + bone groups) — Blender
  //     AnimData slot for binding an Object to one Action. Stage 1.D
  //     adds the __scene__ pseudo-Object for project-wide actions; until
  //     then no actionId is auto-bound.
  //
  // `project.animations` deleted (Rule №2 — no migration baggage).
  // `project.nodeTrees` retirement deferred to a follow-up commit so
  // the rewire vs. retirement diffs stay separable.
  //
  // See `src/store/migrations/v36_action_datablock.js`.
  36: (project) => {
    migrateActionDatablock(project);
    return project;
  },

  // v37 — Animation Phase 1 Stage 1.D: `__scene__` pseudo-Object node
  // carrying project-wide AnimData. The synthetic node lives on
  // `project.nodes` alongside regular Objects so the v36
  // `actionRegistry` helpers walk it uniformly (closing the read/write
  // asymmetry flagged by Audit-fix D-9 in the Stage 1.C audit). The
  // exporter treats `__scene__`'s AnimData identically to an Object
  // AnimData — it walks the FCurves and writes them to motion3.json.
  //
  // See `src/store/migrations/v37_scene_anim_data.js`.
  37: (project) => {
    migrateSceneAnimData(project);
    return project;
  },

  // v38 — Animation Phase 1 Stage 1.F (pre-exit): NodeTree retirement.
  // Strips `project.nodeTrees.{rig, driver, animation}` from old saves.
  // The NodeTreeArea editor now derives trees on-the-fly via
  // `buildRigTreeForPart` / `compileDriverTree` / `compileAnimationTree`,
  // so the persisted shadow is no longer used by any reader.
  //
  // Sister cleanups in this same commit:
  //   - v22 / v23 / v24 entries above are no-op shims (migration MODULES
  //     deleted from disk; entries kept for the contiguous-version
  //     invariant).
  //   - `FCurveStrip` executor's legacy `storage.track` shadow branch
  //     deleted (was reachable only via v24's `compileLegacyAnimationTree`).
  //
  // See `src/store/migrations/v38_nodetree_retirement.js`.
  38: (project) => {
    migrateNodeTreeRetirement(project);
    return project;
  },

  // v19 — Blender Parity Refactor Phase 1C: bone-as-Armature split.
  //
  // Pre-v19 every bone was a flat `group + boneRole` node carrying its
  // own `transform.pivotX/pivotY` (the rest pivot) and inline `pose`
  // (the user's pose deltas). That conflates the Blender notion of
  // `Armature` (the data block holding rest hierarchy) with `Object`
  // (the transform container) AND mixes rest data with pose deltas at
  // the field level on the same node.
  //
  // v19 splits each cluster of `group + boneRole` nodes into:
  //   - One `meshData`-style data node per top-level bone tree,
  //     `{type: 'armatureData', id: '<treeRootId>__armature', bones: BoneRecord[]}`.
  //     Each `BoneRecord` carries `{id, name, role, parent, restPivot}` —
  //     that is, the REST data only. Pose data lives on the corresponding
  //     `Object` (the bone group node, type stays 'group') in
  //     `node.pose.channels` keyed by bone id (replacing today's flat
  //     `node.pose`).
  //   - The original bone-group node KEEPS `type: 'group', boneRole`
  //     for backward compat — readers haven't migrated to look up bones
  //     via the armature data block yet. The new `dataId` pointer on
  //     the TOP-LEVEL bone of each tree links to the synthesised
  //     `armatureData` node so `getArmature(project)` can resolve via
  //     it. Lower bones still discover via their own boneRole field.
  //
  // This is **forward-compat only**: helpers (`getArmature`,
  // `getBoneByRole`, `getBoneByName`, `getBonesIn`, `getBonePose`,
  // `getBoneRestPivot`) are already v17/v18-shape aware and will be
  // updated to read v19 shape post-migration. Schema migration runs
  // ONLY when CURRENT_SCHEMA_VERSION reaches 19, which this session
  // doesn't do — the migration is registered for the gated rollout.
  //
  // # Design notes
  //
  // - Today's `node.pose` (flat) carries one PoseChannel-equivalent per
  //   bone group. Migration aggregates them into the Object's
  //   `pose.channels: {[boneId]: {rotation, x, y, scaleX, scaleY}}`
  //   sub-object. Today the Object IS the bone-group, so each Object
  //   has at most one channel; post-flip the multi-bone Object will
  //   carry one channel per bone in its armature.
  // - Idempotent: skips bones already migrated (data node exists).
  // - Lossless: every field on the legacy bone-group migrates
  //   verbatim. Rest pivot stays on `node.transform.pivotX/pivotY` for
  //   one release (until the bone-group → Object proper rewrite ships
  //   in a follow-up phase) so Phase 1C-flip readers can still find
  //   them; the new `armatureData.bones[].restPivot` is the canonical
  //   destination.
  19: (project) => {
    if (!Array.isArray(project.nodes)) return project;
    const existingIds = new Set();
    for (const n of project.nodes) {
      if (n?.id) existingIds.add(n.id);
    }
    // Find top-level bone groups (parent is null OR parent is a non-bone).
    // Each top-level bone defines an armature tree.
    /** @type {Array<object>} */
    const topLevelBones = [];
    /** @type {Set<string>} */
    const boneIds = new Set();
    for (const n of project.nodes) {
      if (!n || n.type !== 'group' || !n.boneRole) continue;
      boneIds.add(n.id);
    }
    for (const n of project.nodes) {
      if (!boneIds.has(n.id)) continue;
      const parentIsBone = n.parent && boneIds.has(n.parent);
      if (!parentIsBone) topLevelBones.push(n);
    }
    if (topLevelBones.length === 0) return project;

    /** @type {Array<object>} */
    const newDataNodes = [];
    /**
     * Walk the bone subtree rooted at `root` and return a flat list of
     * BoneRecord entries (rest data only).
     */
    const collectBones = (root) => {
      /** @type {Array<{id:string, name:string, role:string|null, parent:string|null, restPivot:{x:number, y:number}}>} */
      const out = [];
      const stack = [root];
      while (stack.length > 0) {
        const cur = stack.pop();
        const t = cur.transform ?? null;
        out.push({
          id: cur.id,
          name: cur.name ?? cur.id,
          role: cur.boneRole ?? null,
          parent: (cur.parent && boneIds.has(cur.parent)) ? cur.parent : null,
          restPivot: { x: t?.pivotX ?? 0, y: t?.pivotY ?? 0 },
        });
        for (const child of project.nodes) {
          if (child.parent === cur.id && boneIds.has(child.id)) {
            stack.push(child);
          }
        }
      }
      return out;
    };

    for (const root of topLevelBones) {
      // Skip already-migrated trees — top-level bone has dataId set
      // and a matching `armatureData` node exists.
      if (typeof root.dataId === 'string' && existingIds.has(root.dataId)) continue;
      let dataId = `${root.id}__armature`;
      if (existingIds.has(dataId)) {
        let i = 2;
        while (existingIds.has(`${root.id}__armature${i}`)) i++;
        dataId = `${root.id}__armature${i}`;
      }
      existingIds.add(dataId);
      const bones = collectBones(root);
      newDataNodes.push({
        id: dataId,
        type: 'armatureData',
        bones,
      });
      root.dataId = dataId;
    }

    // Migrate flat `node.pose` → `Object.pose.channels[boneId]` shape on
    // every bone group. Today each bone-group node IS the Object that
    // owns the pose for itself, so `pose.channels` carries exactly one
    // entry keyed by the same node's id. The next-phase rewrite will
    // collapse these into per-armature-Object channel maps.
    for (const n of project.nodes) {
      if (!boneIds.has(n.id)) continue;
      const flatPose = n.pose;
      if (flatPose && typeof flatPose === 'object' && !flatPose.channels) {
        n.pose = {
          channels: { [n.id]: flatPose },
        };
      }
    }

    if (newDataNodes.length > 0) {
      project.nodes.push(...newDataNodes);
    }
    return project;
  },

  // v18 — Blender Parity Refactor Phase 1: Object / ObjectData split for
  // meshes (bone armature split deferred to Phase 1C).
  //
  // Pre-v18 every `part` node carried its mesh payload inline as
  // `node.mesh = { vertices, uvs, triangles, edgeIndices, blendShapes?,
  // blendShapeValues?, boneWeights?, jointBoneId?, weightGroups?, ... }`.
  // That conflates the Blender notion of `Object` (transform + draw_order
  // container) with `ObjectData` (the geometry payload), which blocks
  // multi-object edit, instancing, and clean modifier-stack semantics.
  //
  // v18 splits each part with mesh data into TWO nodes:
  //   - The `part` node keeps its `id, type, name, parent, transform,
  //     draw_order, opacity, visible, clip_mask, blendShapes,
  //     blendShapeValues, ...` (everything that's container-y), gains a
  //     new `dataId: '<meshData-id>'` pointer, and DROPS its inline
  //     `node.mesh`.
  //   - A new `{type: 'meshData', id: '<part-id>__data', ...}` node holds
  //     the geometry payload (vertices, uvs, triangles, edgeIndices,
  //     boneWeights, jointBoneId, weightGroups, activeWeightGroup,
  //     maskMeshIds, textureId).
  //
  // Idempotent: skips parts that already carry `dataId` and a matching
  // `meshData` node. Lossless for the migrated fields — every field on
  // the old `node.mesh` lands on the new data node verbatim.
  //
  // Reader contract: `getMesh(node, project)` resolves either shape — if
  // `node.dataId` is set and a matching `meshData` node exists, return
  // it; otherwise fall back to `node.mesh`. Callers don't change.
  //
  // Bones (`group + boneRole`) are NOT migrated to Armature shape in
  // v18 — that's deferred to Phase 1C because it touches every bone
  // hit-test, pose write, SkeletonOverlay drag, and rig-pipeline reader,
  // and warrants its own schema bump + dedicated round-trip sweep.
  18: (project) => {
    if (!Array.isArray(project.nodes)) return project;
    const existingIds = new Set();
    for (const n of project.nodes) {
      if (n?.id) existingIds.add(n.id);
    }
    /** @type {Array<object>} */
    const newDataNodes = [];
    for (const node of project.nodes) {
      if (!node || node.type !== 'part') continue;
      // Skip already-migrated parts.
      if (typeof node.dataId === 'string' && existingIds.has(node.dataId)) continue;
      const mesh = node.mesh;
      if (!mesh || typeof mesh !== 'object') continue;
      // Pick a stable id for the data node. Suffix `__data` is reserved
      // for migrated meshData entries; collision-defend by appending an
      // index if the id is already taken (e.g. user-named node landed on
      // the suffix).
      let dataId = `${node.id}__data`;
      if (existingIds.has(dataId)) {
        let i = 2;
        while (existingIds.has(`${node.id}__data${i}`)) i++;
        dataId = `${node.id}__data${i}`;
      }
      existingIds.add(dataId);
      // Hoist every property of the inline mesh to the new data node.
      // Spread preserves Float32Array / Set / etc. references — JSON
      // re-serialisation downstream handles encoding for save.
      newDataNodes.push({
        ...mesh,
        id: dataId,
        type: 'meshData',
      });
      node.dataId = dataId;
      delete node.mesh;
    }
    if (newDataNodes.length > 0) {
      project.nodes.push(...newDataNodes);
    }
    return project;
  },

  // v17 — Blender-style rest/pose split for bone groups.
  //
  // Pre-v17 every bone-group `node.transform` carried a mix of "rest
  // layout" fields (`pivotX`/`pivotY` — where the joint actually sits)
  // and "pose offset" fields (`rotation` / `x` / `y` / `scale*` —
  // user's drag deltas in skeleton edit and pose work). That mix made
  // it impossible to do "Apply Pose As Rest" cleanly: there was no
  // separate slot to bake INTO, and nothing distinguished a rest pivot
  // change (Skeleton Edit Mode) from a pose drag.
  //
  // v17 adds `node.pose = { rotation, x, y, scaleX, scaleY }` for
  // every bone-group node. `node.transform.{rotation, x, y, scaleX,
  // scaleY}` is RESERVED (kept at identity) — only `pivotX/pivotY`
  // remains meaningful on bone-group transforms post-v17.
  //
  // Legacy `transform.{rotation, x, y, scaleX, scaleY}` values
  // (non-default, written by pre-v17 SkeletonOverlay drags) migrate
  // into `pose` so the user's saved pose survives the format change.
  // Non-bone nodes (parts, plain groups, deformers) keep `transform`
  // untouched — pose semantics only apply to bones.
  17: (project) => {
    for (const node of project.nodes ?? []) {
      if (!node || node.type !== 'group' || !node.boneRole) continue;
      // Establish pose slot. Pre-existing pose (from a re-save mid-
      // migration) wins over re-deriving from transform.
      if (!node.pose || typeof node.pose !== 'object') {
        node.pose = identityPose();
      } else {
        const p = node.pose;
        if (typeof p.rotation !== 'number') p.rotation = 0;
        if (typeof p.x        !== 'number') p.x        = 0;
        if (typeof p.y        !== 'number') p.y        = 0;
        if (typeof p.scaleX   !== 'number') p.scaleX   = 1;
        if (typeof p.scaleY   !== 'number') p.scaleY   = 1;
      }
      // Lift legacy pose values out of transform.
      if (node.transform && typeof node.transform === 'object') {
        const t = node.transform;
        const hasPose =
             (typeof t.rotation === 'number' && Math.abs(t.rotation) > 1e-9)
          || (typeof t.x        === 'number' && Math.abs(t.x)        > 1e-9)
          || (typeof t.y        === 'number' && Math.abs(t.y)        > 1e-9)
          || (typeof t.scaleX   === 'number' && Math.abs(t.scaleX - 1) > 1e-9)
          || (typeof t.scaleY   === 'number' && Math.abs(t.scaleY - 1) > 1e-9);
        if (hasPose) {
          node.pose.rotation = t.rotation ?? 0;
          node.pose.x        = t.x        ?? 0;
          node.pose.y        = t.y        ?? 0;
          node.pose.scaleX   = t.scaleX   ?? 1;
          node.pose.scaleY   = t.scaleY   ?? 1;
        }
        t.rotation = 0;
        t.x        = 0;
        t.y        = 0;
        t.scaleX   = 1;
        t.scaleY   = 1;
      }
    }
    return project;
  },
};

/**
 * Migrate a parsed project JSON to CURRENT_SCHEMA_VERSION in place.
 *
 * @param {object} project - parsed contents of project.json
 * @returns {object} - the same object, mutated, at current version
 * @throws if the project is from a future schema version this build
 *         doesn't recognise.
 */
export function migrateProject(project) {
  const fromVersion = project.schemaVersion ?? 0;

  if (fromVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project schema v${fromVersion} is newer than this build supports ` +
      `(v${CURRENT_SCHEMA_VERSION}). Upgrade Stretchy Studio.`
    );
  }

  for (let v = fromVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const migrate = MIGRATIONS[v];
    if (!migrate) {
      throw new Error(`No migration registered for schema v${v}`);
    }
    migrate(project);
    project.schemaVersion = v;
  }

  return project;
}
