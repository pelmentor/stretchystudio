import { create } from 'zustand';
import { produce } from 'immer';
import { pushSnapshot, isBatching, clearHistory } from './undoHistory.js';
import { CURRENT_SCHEMA_VERSION, migrateProject } from './projectMigrations.js';
import { seedParameters as seedParametersFn } from '../io/live2d/rig/paramSpec.js';
import { seedMaskConfigs as seedMaskConfigsFn } from '../io/live2d/rig/maskConfigs.js';
import { seedPhysicsRules as seedPhysicsRulesFn } from '../io/live2d/rig/physicsConfig.js';
import { seedBoneConfig as seedBoneConfigFn } from '../io/live2d/rig/boneConfig.js';
import { seedVariantFadeRules as seedVariantFadeRulesFn } from '../io/live2d/rig/variantFadeRules.js';
import { seedEyeClosureConfig as seedEyeClosureConfigFn } from '../io/live2d/rig/eyeClosureConfig.js';
import { seedRotationDeformerConfig as seedRotationDeformerConfigFn } from '../io/live2d/rig/rotationDeformerConfig.js';
import { seedAutoRigConfig as seedAutoRigConfigFn } from '../io/live2d/rig/autoRigConfig.js';
import {
  seedFaceParallax as seedFaceParallaxFn,
  clearFaceParallax as clearFaceParallaxFn,
} from '../io/live2d/rig/faceParallaxStore.js';
import {
  seedBodyWarpChain as seedBodyWarpChainFn,
  clearBodyWarp as clearBodyWarpFn,
} from '../io/live2d/rig/bodyWarpStore.js';
import {
  seedRigWarps as seedRigWarpsFn,
  clearRigWarps as clearRigWarpsFn,
} from '../io/live2d/rig/rigWarpsStore.js';
import { computeProjectSignatures } from '../io/meshSignature.js';
import {
  rotationSpecToDeformerNode,
  upsertDeformerNode,
  removeAllRotationDeformerNodes,
} from './deformerNodeSync.js';
import { findOrphanReferences } from '../io/live2d/rig/paramReferences.js';
import { logger } from '../lib/logger.js';
import { uid } from '../lib/ids.js';

/**
 * Deep clone an object, preserving TypedArrays.
 * Safe for use with Immer draft proxies.
 */
function deepClone(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (obj instanceof Float32Array) return new Float32Array(obj);
  if (obj instanceof Uint16Array) return new Uint16Array(obj);
  if (obj instanceof Uint32Array) return new Uint32Array(obj);
  if (Array.isArray(obj)) return obj.map(deepClone);
  const cloned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

export const DEFAULT_TRANSFORM = () => ({
  x: 0, y: 0,
  rotation: 0,
  scaleX: 1, scaleY: 1,
  pivotX: 0, pivotY: 0,
});

// Project store (The .stretch model, undoable)
export const useProjectStore = create((set, get) => {
  // Helper that lifts a `(project, ...args) => void` mutator function
  // into a zustand action with the standard ritual:
  //   1. Snapshot the pre-mutation project for undo (unless mid-batch).
  //   2. Run the function under immer's `produce` so its mutations
  //      are structurally shared.
  //   3. Mark hasUnsavedChanges.
  //
  // The 14 seed/clear actions below used to inline this 4-line ritual;
  // 56 LOC of cargo-cult plus 14 places to forget the snapshot guard.
  // Now there's one place. (Phase 0F.9 / Pillar A.)
  /** @param {(project: any, ...args: any[]) => void} fn */
  const projectMutator = (fn) => (/** @type {any[]} */ ...args) =>
    set((state) => {
      if (!isBatching()) pushSnapshot(state.project);
      return produce(state, (draft) => {
        fn(draft.project, ...args);
        draft.hasUnsavedChanges = true;
      });
    });

  return {
  project: {
    version: "0.1",
    schemaVersion: CURRENT_SCHEMA_VERSION,
    canvas: { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' },
    textures: [],     // { id, source (data URI or Blob URL) }
    nodes: [],        // flat array — see node schemas below
    /*
      Node schema (type === 'part'):
      {
        id:         string,
        type:       'part',
        name:       string,
        parent:     string | null,      // id of parent group, or null
        draw_order: number,
        opacity:    number (0–1),
        visible:    boolean,
        clip_mask:  string | null,
        transform:  { x, y, rotation, scaleX, scaleY, pivotX, pivotY },
        meshOpts:   { alphaThreshold, smoothPasses, gridSpacing, edgePadding, numEdgePoints } | null,
        mesh:       { vertices, uvs, triangles, edgeIndices } | null,
        blendShapes: [{ id, name, deltas: [{dx, dy}], pinDeltas: [{pinId, dx, dy}] | null }] | null,
        blendShapeValues: { [shapeId]: number (0–1) },             // staging-mode influences
      }

      Node schema (type === 'group'):
      {
        id:         string,
        type:       'group',
        name:       string,
        parent:     string | null,
        opacity:    number (0–1),
        visible:    boolean,
        transform:  { x, y, rotation, scaleX, scaleY, pivotX, pivotY },
        // NO draw_order — groups are never drawn directly.
        // Render order is determined solely by part.draw_order values.
      }
    */
    parameters: [],
    physics_groups: [],
    animations: [],
    maskConfigs: [],
    physicsRules: [],
    boneConfig: null,
    variantFadeRules: null,
    eyeClosureConfig: null,
    rotationDeformerConfig: null,
    autoRigConfig: null,
    faceParallax: null,
    bodyWarp: null,
    rigWarps: {},
    meshSignatures: {},
    lastInitRigCompletedAt: null,
    rigStageLastRunAt: {},
  },

  // Versions used to trigger rendering passes independently of React
  versionControl: {
    geometryVersion: 0,
    transformVersion: 0,
    textureVersion: 0,
  },

  hasUnsavedChanges: false,

  /**
   * Phase 1G — id of the IndexedDB library record this project was last
   * loaded from / saved to. When non-null, the next "Save to Library"
   * overwrites that record instead of creating a new one. Cleared on
   * `file.new` and on `loadProject`-from-disk so a fresh project starts
   * unlinked from the library. Library save sets it to the new record's
   * id; library load sets it to the loaded record's id.
   *
   * @type {string|null}
   */
  currentLibraryId: null,
  setCurrentLibraryId: (/** @type {string|null} */ id) => set({ currentLibraryId: id }),

  // ── Actions ────────────────────────────────────────────────────────────────

  /** Generic immer recipe — use for all undoable project edits.
   *  Auto-snapshots before mutation unless { skipHistory: true } is passed. */
  updateProject: (recipe, { skipHistory = false } = {}) => set((state) => {
    let hasUnsavedChanges = state.hasUnsavedChanges;
    if (!skipHistory && !isBatching()) {
      pushSnapshot(state.project);
      hasUnsavedChanges = true;
    }
    return produce((state) => {
      state.hasUnsavedChanges = hasUnsavedChanges;
      recipe(state.project, state.versionControl);
    })(state);
  }),

  setHasUnsavedChanges: (val) => set({ hasUnsavedChanges: val }),

  /** Create a new empty group node */
  createGroup: (name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    state.project.nodes.push({
      id:        uid(),
      type:      'group',
      name:      name ?? 'Group',
      parent:    null,
      transform: DEFAULT_TRANSFORM(),
      visible:   true,
      opacity:   1,
    });
    state.versionControl.transformVersion++;
  })),

  /**
   * Reparent a node to a new parent (or to root if newParentId is null).
   * Never touches draw_order.
   */
  reparentNode: (nodeId, newParentId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (node) node.parent = newParentId ?? null;
    state.versionControl.transformVersion++;
  })),
  /**
   * Animation CRUD
   */
  createAnimation: (name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const id = uid();
    state.project.animations.push({
      id,
      name:        name ?? `Animation ${state.project.animations.length + 1}`,
      duration:    2000,
      fps:         24,
      tracks:      [],
      audioTracks: [],
    });
  })),

  renameAnimation: (id, newName) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const anim = state.project.animations.find(a => a.id === id);
    if (anim) anim.name = newName;
  })),

  deleteAnimation: (id) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    state.project.animations = state.project.animations.filter(a => a.id !== id);
  })),

  /** Create a new blend shape on a part node */
  createBlendShape: (nodeId, name) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node || !node.mesh) return;
    const id = uid();
    const deltas = node.mesh.vertices.map(() => ({ dx: 0, dy: 0 }));
    if (!node.blendShapes) node.blendShapes = [];
    if (!node.blendShapeValues) node.blendShapeValues = {};
    node.blendShapes.push({ id, name: name ?? 'Key', deltas });
    node.blendShapeValues[id] = 0;
    state.versionControl.geometryVersion++;
  })),

  /** Delete a blend shape from a part node */
  deleteBlendShape: (nodeId, shapeId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node) return;
    if (node.blendShapes) {
      node.blendShapes = node.blendShapes.filter(s => s.id !== shapeId);
    }
    if (node.blendShapeValues) {
      delete node.blendShapeValues[shapeId];
    }
    state.versionControl.geometryVersion++;
  })),

  /** Set the influence value of a blend shape in staging mode */
  setBlendShapeValue: (nodeId, shapeId, value) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (node && node.blendShapeValues) {
      node.blendShapeValues[shapeId] = Math.max(0, Math.min(1, value));
      state.versionControl.geometryVersion++;
    }
  })),

  /** Update the deltas of a blend shape (used by edit mode brush) */
  updateBlendShapeDeltas: (nodeId, shapeId, deltas) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find(n => n.id === nodeId);
    if (!node) return;
    const shape = node.blendShapes?.find(s => s.id === shapeId);
    if (shape) {
      shape.deltas = deltas;
      state.versionControl.geometryVersion++;
    }
  })),

  /** Reset project to empty state */
  resetProject: () => {
    clearHistory();
    return set(produce((state) => {
      state.project.canvas   = { width: 800, height: 600, x: 0, y: 0, bgEnabled: false, bgColor: '#ffffff' };
      state.project.textures = [];
      state.project.nodes    = [];
      state.project.parameters = [];
      state.project.physics_groups = [];
      state.project.animations = [];
      state.project.maskConfigs = [];
      state.project.physicsRules = [];
      state.project.boneConfig = null;
      state.project.variantFadeRules = null;
      state.project.eyeClosureConfig = null;
      state.project.rotationDeformerConfig = null;
      state.project.autoRigConfig = null;
      state.project.faceParallax = null;
      state.project.bodyWarp = null;
      state.project.rigWarps = {};
      state.project.rigStageLastRunAt = {};
      state.versionControl.geometryVersion++;
      state.versionControl.transformVersion++;
      state.versionControl.textureVersion++;
      state.hasUnsavedChanges = false;
      // Phase 1G — fresh project unlinks from any library record so the
      // next save creates a new record rather than overwriting one.
      state.currentLibraryId = null;
    }));
  },

  /** Load a deserialized project from file */
  loadProject: (projectData) => {
    // Idempotent — the file loader (projectFile.loadProject) has already
    // migrated, but call again here to defend against direct callers.
    migrateProject(projectData);
    clearHistory();
    return set(produce((state) => {
      state.project.version = projectData.version;
      state.project.schemaVersion = projectData.schemaVersion;
      state.project.canvas = projectData.canvas;
      state.project.textures = projectData.textures;
      state.project.nodes = projectData.nodes;
      state.project.animations = projectData.animations;
      state.project.parameters = projectData.parameters;
      state.project.physics_groups = projectData.physics_groups;
      state.project.maskConfigs = projectData.maskConfigs;
      state.project.physicsRules = projectData.physicsRules;
      state.project.boneConfig = projectData.boneConfig;
      state.project.variantFadeRules = projectData.variantFadeRules;
      state.project.eyeClosureConfig = projectData.eyeClosureConfig;
      state.project.rotationDeformerConfig = projectData.rotationDeformerConfig;
      // Stage 1b: previously-dropped fields. Loading a `.stretch` saved
      // after a rig init would silently lose its keyform stores; the
      // generator path then re-fired on every export, masking the loss.
      state.project.autoRigConfig = projectData.autoRigConfig ?? null;
      state.project.faceParallax = projectData.faceParallax ?? null;
      state.project.bodyWarp = projectData.bodyWarp ?? null;
      state.project.rigWarps = projectData.rigWarps ?? {};
      // GAP-012 step 2: meshSignatures captured at last seedAllRig.
      // Load preserves them verbatim; the StaleRigBanner re-validates
      // against current node geometry on every render.
      state.project.meshSignatures = projectData.meshSignatures ?? {};
      // Hole I-8: explicit Init Rig completion marker. Null on legacy
      // saves; exporter's seeded-state check falls back to the old
      // heuristic when the marker is missing.
      state.project.lastInitRigCompletedAt = projectData.lastInitRigCompletedAt ?? null;
      state.project.rigStageLastRunAt = projectData.rigStageLastRunAt ?? {};
      // Phase 1G — disk-loaded projects start unlinked from any library
      // record. The library-load operator sets `currentLibraryId` itself
      // after this call so a "save" goes back to the correct record.
      state.currentLibraryId = null;
      state.versionControl.geometryVersion++;
      state.versionControl.transformVersion++;
      state.versionControl.textureVersion++;
      state.hasUnsavedChanges = false;
    }));
  },

  /**
   * Seed `project.parameters` from the auto-rig generator (Stage 1).
   * Destructive: overwrites whatever was there. The seeder runs the
   * generator path of `buildParameterSpec` and stores its full output,
   * after which the export pipeline takes the native rig path for
   * parameters (no synthesis).
   *
   * Snapshots history so the user can undo.
   */
  seedParameters:             projectMutator(seedParametersFn),

  /**
   * Seed `project.maskConfigs` from the auto-rig heuristic (Stage 3).
   * Iris↔eyewhite pairings (variant-aware) are baked into project state.
   * Destructive: overwrites whatever was there.
   */
  seedMaskConfigs:            projectMutator(seedMaskConfigsFn),

  /**
   * Seed `project.physicsRules` from DEFAULT_PHYSICS_RULES (Stage 6).
   * boneOutputs are resolved against the project's groups (boneRole
   * lookup) and flattened into outputs[]. Destructive.
   */
  seedPhysicsRules:           projectMutator(seedPhysicsRulesFn),

  /**
   * Seed `project.boneConfig` from defaults (Stage 7). Currently sets
   * `bakedKeyformAngles` to [-90, -45, 0, 45, 90]. Destructive.
   */
  seedBoneConfig:             projectMutator(seedBoneConfigFn),

  /**
   * Seed `project.variantFadeRules` from defaults (Stage 5). Currently
   * sets `backdropTags` to the canonical Hiyori-style list (face, ears,
   * front+back hair). Destructive.
   */
  seedVariantFadeRules:       projectMutator(seedVariantFadeRulesFn),

  /**
   * Seed `project.eyeClosureConfig` from defaults (Stage 5). Currently
   * sets per-side eyelash/eyewhite/irides closureTags + lashStripFrac=0.06
   * + binCount=6. Destructive.
   */
  seedEyeClosureConfig:       projectMutator(seedEyeClosureConfigFn),

  /**
   * Seed `project.rotationDeformerConfig` from defaults (Stage 8). Sets
   * `skipRotationRoles=['torso','eyes','neck']`, `paramAngleRange=±30`,
   * `groupRotation` 1:1 ±30, `faceRotation` ±10° on ±30 keys. Destructive.
   */
  seedRotationDeformerConfig: projectMutator(seedRotationDeformerConfigFn),

  /**
   * Seed `project.autoRigConfig` from defaults (Stage 2). Three sections —
   * bodyWarp (HIP/FEET fallbacks, BX/BY/Breath margins, upper-body shape),
   * faceParallax (depth coefficients, protection per tag, eye/squash amps,
   * super-groups), neckWarp (tilt fraction). Destructive.
   */
  seedAutoRigConfig:          projectMutator(seedAutoRigConfigFn),

  /**
   * Seed `project.faceParallax` from a pre-computed spec (Stage 4).
   * Caller is responsible for producing the spec — typically via
   * `buildFaceParallaxSpec(...)` with current mesh / bbox / pivot
   * inputs. Destructive: overwrites prior storage.
   */
  seedFaceParallax:           projectMutator(seedFaceParallaxFn),

  /**
   * Clear `project.faceParallax` to revert to the heuristic generator
   * path. Use after PSD reimport invalidates stored vertex deltas.
   */
  clearFaceParallax:          projectMutator(clearFaceParallaxFn),

  /**
   * Seed `project.bodyWarp` from a pre-computed chain (Stage 10).
   * Caller is responsible for producing the chain — typically via
   * `buildBodyWarpChain(...)` with current mesh / canvas / body-anatomy
   * inputs. Destructive: overwrites prior storage.
   */
  seedBodyWarp:               projectMutator(seedBodyWarpChainFn),

  /**
   * Clear `project.bodyWarp` to revert to the heuristic generator
   * path. Use after PSD reimport invalidates stored vertex deltas
   * or body silhouette anchors.
   */
  clearBodyWarp:              projectMutator(clearBodyWarpFn),

  /**
   * Seed `project.rigWarps` from a pre-computed `partId → spec` map
   * (or iterable of specs with `targetPartId`) — Stage 9b. Caller is
   * typically a rig-init flow that runs `generateCmo3` once and
   * harvests `rigSpec.warpDeformers` filtered to per-mesh entries.
   * Destructive: overwrites the entire stored map.
   */
  seedRigWarps:               projectMutator(seedRigWarpsFn),

  /**
   * Clear `project.rigWarps` to revert to the heuristic shiftFn
   * path. Use after PSD reimport invalidates stored per-vertex
   * deltas or any binding-axis change.
   */
  clearRigWarps:              projectMutator(clearRigWarpsFn),

  /**
   * Stage 1b — orchestrator that seeds every native-rig store from a
   * single harvest pass. Caller (UI: v3 ParametersEditor "Initialize Rig"
   * button → RigService.initializeRig) supplies the harvest result from
   * `initializeRigFromProject(project, images)`. Single snapshot covers
   * all writes so undo reverts the whole init in one step.
   *
   * **Mode (V3 Re-Rig Phase 0):**
   *   - `'replace'` (default, back-compat): full destructive re-init —
   *     what "Re-Init Rig" + StaleRigBanner do today.
   *   - `'merge'`: preserves user-authored entries on conflict-surface
   *     fields (maskConfigs, physicsRules, faceParallax, bodyWarp,
   *     rigWarps); used by Phase 1's per-stage refit + "Refit All" UI.
   *     `subsystems` is preserved in BOTH modes (the headline Phase 0 fix).
   *
   * In merge mode, `clearFaceParallax` / `clearBodyWarp` / `clearRigWarps`
   * are bypassed — clearing a slot the user hasn't authored is fine, but
   * we don't want a missing-value harvest to wipe a user's authored spec.
   *
   * @param {{
   *   faceParallaxSpec: object|null,
   *   bodyWarpChain: object|null,
   *   rigWarps: Map<string,object>,
   * }} harvest
   * @param {'replace'|'merge'} [mode='replace']
   */
  seedAllRig: (harvest, mode = 'replace') => {
    set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      const proj = draft.project;
      // Config-only seeders (no keyforms). Pure defaults; merge==replace.
      seedParametersFn(proj);
      seedMaskConfigsFn(proj, mode);
      seedPhysicsRulesFn(proj, mode);
      seedBoneConfigFn(proj);
      seedVariantFadeRulesFn(proj);
      seedEyeClosureConfigFn(proj);
      seedRotationDeformerConfigFn(proj);
      seedAutoRigConfigFn(proj, mode);
      // Keyform-bearing seeders. Each only fires when the harvester
      // actually produced a value — buildBodyWarpChain returns null for
      // models without ParamBodyAngleZ/Y, faceParallax is null when no
      // face-tagged meshes exist, etc.
      if (harvest?.faceParallaxSpec) {
        seedFaceParallaxFn(proj, harvest.faceParallaxSpec, mode);
      } else if (mode === 'replace') {
        clearFaceParallaxFn(proj);
      }
      if (harvest?.bodyWarpChain) {
        seedBodyWarpChainFn(proj, harvest.bodyWarpChain, mode);
      } else if (mode === 'replace') {
        clearBodyWarpFn(proj);
      }
      if (harvest?.rigWarps && harvest.rigWarps.size > 0) {
        seedRigWarpsFn(proj, harvest.rigWarps, mode);
      } else if (mode === 'replace') {
        clearRigWarpsFn(proj);
      }
      // BFA-006 Phase 3 — dual-write rotation deformer nodes from the
      // harvest's rigSpec so `selectRigSpec(project)` picks them up
      // alongside the warp deformer nodes that Phase 1 already
      // dual-writes via the seedXxx warp seeders. Rotation deformers
      // were never persisted in sidetables (they're (re)generated
      // every Init Rig); this write is what closes the post-load
      // "click Init Rig to rebuild" gap once the project's been
      // through one Init Rig pass under Phase 3+.
      //
      // Replace mode wipes all prior rotation nodes before upserting
      // the harvest output. Merge mode preserves _userAuthored
      // entries by id (same semantics the warp dual-writes use).
      const rotationDeformers = harvest?.rigSpec?.rotationDeformers ?? [];
      if (Array.isArray(proj.nodes)) {
        if (mode === 'replace') {
          removeAllRotationDeformerNodes(proj.nodes);
        } else {
          // Merge mode: drop only the rotations being overwritten;
          // _userAuthored survivors stay in place.
          const incomingIds = new Set(rotationDeformers.map((r) => r?.id).filter(Boolean));
          for (let i = proj.nodes.length - 1; i >= 0; i--) {
            const n = proj.nodes[i];
            if (n?.type !== 'deformer' || n.deformerKind !== 'rotation') continue;
            if (incomingIds.has(n.id) && n._userAuthored !== true) {
              proj.nodes.splice(i, 1);
            }
          }
        }
        for (const spec of rotationDeformers) {
          if (!spec || !spec.id) continue;
          if (mode === 'merge') {
            const prior = proj.nodes.find(
              (n) => n && n.id === spec.id && n.type === 'deformer'
            );
            if (prior && prior._userAuthored === true) continue;
          }
          upsertDeformerNode(proj.nodes, rotationSpecToDeformerNode(spec));
        }
      }
      // GAP-012 Phase A — capture per-mesh fingerprint at seed time so
      // PSD reimport can detect when stored vertex-indexed keyforms have
      // gone stale (mesh re-mesh changes vertex order/count, breaking
      // positional indexing of `keyform.positions`). Detection only:
      // `validateProjectSignatures(project)` returns the divergence
      // report; consumer (UI banner) decides what to do.
      proj.meshSignatures = computeProjectSignatures(proj);
      // Hole I-8: explicit completion marker beats heuristic-detection
      // of partially-seeded state in exporter's resolveAllKeyformSpecs.
      // ISO timestamp; readable in logs / debug if needed.
      proj.lastInitRigCompletedAt = new Date().toISOString();
      draft.hasUnsavedChanges = true;
    });
    });
    // GAP-013 / Hole I-3 — after seedAllRig (which re-runs seedParameters
    // with current tag coverage and may drop tag-gated standard params
    // when their tag isn't present anymore), enumerate references in
    // animations/bindings/physicsRules that no longer resolve. Detection
    // only — Logs panel shows the per-ref locations; remediation is the
    // user's call (today: ignore; future Param Editor UI: orphan-cleanup
    // dialog). Runs outside the immer `produce` because
    // findOrphanReferences reads the post-seed project; the `set` above
    // committed before this returns.
    const postSeedProject = get().project;
    const orphans = findOrphanReferences(postSeedProject);
    const orphanIds = Object.keys(orphans);
    if (orphanIds.length > 0) {
      logger.warn(
        'paramOrphans',
        `${orphanIds.length} orphan parameter ref(s) after Init Rig: ${orphanIds.join(', ')}`,
        Object.fromEntries(
          orphanIds.map(id => [id, {
            animationTracks: orphans[id].animationTracks.map(r => r.location),
            bindings:        orphans[id].bindings.map(r => r.location),
            physicsInputs:   orphans[id].physicsInputs.map(r => r.location),
          }])
        )
      );
    }
    // Hole I-5: bone-reference orphans. `node.mesh.jointBoneId` is a
    // node-id pointer to the bone group that owns the skinning; if the
    // group was deleted/renamed, the rotation keyforms quietly emit
    // against a phantom bone. Detection only — UI bone-edit operators
    // will gate the rename/delete in Phase B.
    const groupIds = new Set();
    for (const n of postSeedProject.nodes ?? []) {
      if (n?.type === 'group') groupIds.add(n.id);
    }
    const boneOrphans = [];
    for (const n of postSeedProject.nodes ?? []) {
      if (n?.type !== 'part' || !n.mesh?.jointBoneId) continue;
      if (!groupIds.has(n.mesh.jointBoneId)) {
        boneOrphans.push({ partId: n.id, partName: n.name, jointBoneId: n.mesh.jointBoneId });
      }
    }
    if (boneOrphans.length > 0) {
      logger.warn(
        'boneOrphans',
        `${boneOrphans.length} mesh skinning ref(s) point at missing bone group(s)`,
        { orphans: boneOrphans }
      );
    }
    // Hole I-6: physicsRules[].outputs reference bone group NAMES
    // (resolved through `boneOutputs`, see physicsConfig). When the
    // group renamed/deleted, output silently zeros. Cross-check rule
    // outputs against current group names + ids; warn on miss.
    const groupNames = new Set();
    for (const n of postSeedProject.nodes ?? []) {
      if (n?.type === 'group' && typeof n.name === 'string') groupNames.add(n.name);
    }
    const physicsOrphans = [];
    for (let ri = 0; ri < (postSeedProject.physicsRules ?? []).length; ri++) {
      const rule = postSeedProject.physicsRules[ri];
      const outs = Array.isArray(rule?.outputs) ? rule.outputs : [];
      for (let oi = 0; oi < outs.length; oi++) {
        const out = outs[oi];
        const target = typeof out === 'string' ? out : out?.bone ?? out?.boneId;
        if (!target) continue;
        if (!groupNames.has(target) && !groupIds.has(target)) {
          physicsOrphans.push({ ruleIdx: ri, ruleName: rule?.name ?? null, output: target, location: `physicsRules[${ri}]:outputs[${oi}]` });
        }
      }
    }
    if (physicsOrphans.length > 0) {
      logger.warn(
        'physicsOrphans',
        `${physicsOrphans.length} physics rule output(s) reference missing group(s)`,
        { orphans: physicsOrphans }
      );
    }
  },

  /**
   * Stage 1b — clear all keyform-bearing stores (faceParallax,
   * bodyWarp, rigWarps) so the export pipeline falls back to the
   * inline heuristics. Config-only seeded fields (parameters, masks,
   * physics rules, etc.) are left intact.
   */
  clearRigKeyforms: () => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      clearFaceParallaxFn(draft.project);
      clearBodyWarpFn(draft.project);
      clearRigWarpsFn(draft.project);
      draft.hasUnsavedChanges = true;
    });
  }),

  /** Update canvas properties */
  updateCanvas: (partial) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    Object.assign(state.project.canvas, partial);
  })),

  /**
   * Recursively duplicate a node and its children.
   * Also duplicates animation tracks.
   */
  duplicateNode: (nodeId) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);

    return produce(state, (draft) => {
      draft.hasUnsavedChanges = true;
      const proj = draft.project;
      const idsToMap = new Map(); // oldId -> newId

      function doDuplicate(id, parentId) {
        const original = proj.nodes.find(n => n.id === id);
        if (!original) return null;

        const newId = uid();
        idsToMap.set(id, newId);

        const newNode = deepClone(original);
        newNode.id = newId;
        newNode.parent = parentId;
        newNode.name = original.name + ' Copy';

        // For parts, handle draw_order and texture duplication
        if (original.type === 'part') {
          // Texture entry
          const originalTex = proj.textures.find(t => t.id === id);
          if (originalTex) {
            proj.textures.push({
              ...originalTex,
              id: newId
            });
          }

          // Increment draw_order of all parts that are currently at or above the original's draw order
          proj.nodes.forEach(n => {
            if (n.type === 'part' && n.draw_order > original.draw_order) {
              n.draw_order++;
            }
          });
          newNode.draw_order = original.draw_order + 1;
        }

        // Insert into flat nodes array
        proj.nodes.push(newNode);

        // Recursively duplicate children
        const children = proj.nodes.filter(n => n.parent === id && !idsToMap.has(n.id));
        for (const child of children) {
          doDuplicate(child.id, newId);
        }
        return newId;
      }

      const rootNode = proj.nodes.find(n => n.id === nodeId);
      if (!rootNode) return;

      doDuplicate(nodeId, rootNode.parent);

      // Duplicate animation tracks for all duplicated nodes
      for (const [oldId, newId] of idsToMap) {
        for (const anim of proj.animations) {
          const tracks = anim.tracks.filter(t => t.nodeId === oldId);
          for (const track of tracks) {
            anim.tracks.push({
              ...deepClone(track),
              nodeId: newId,
            });
          }
        }
      }

      draft.versionControl.transformVersion++;
      draft.versionControl.geometryVersion++;
    });
  }),

  /**
   * Recursively delete a node and all its children.
   * Also cleans up animation tracks.
   */
  deleteNode: (nodeId) => set((state) => {
    if (!isBatching()) pushSnapshot(state.project);

    return produce(state, (draft) => {
      draft.hasUnsavedChanges = true;
      const proj = draft.project;
      const idsToDelete = new Set();

      function collectRecursive(id) {
        idsToDelete.add(id);
        const children = proj.nodes.filter(n => n.parent === id);
        for (const child of children) {
          collectRecursive(child.id);
        }
      }

      collectRecursive(nodeId);

      // Remove nodes
      proj.nodes = proj.nodes.filter(n => !idsToDelete.has(n.id));

      // Remove textures
      proj.textures = proj.textures.filter(t => !idsToDelete.has(t.id));

      // Remove animation tracks
      for (const anim of proj.animations) {
        anim.tracks = anim.tracks.filter(t => !idsToDelete.has(t.nodeId));
      }

      // Re-normalize draw_order for remaining parts to ensure no gaps (optional but clean)
      const remainingParts = proj.nodes
        .filter(n => n.type === 'part')
        .sort((a, b) => a.draw_order - b.draw_order);
      
      remainingParts.forEach((p, i) => {
        p.draw_order = i;
      });

      draft.versionControl.transformVersion++;
      draft.versionControl.geometryVersion++;
    });
  }),
  };
});
