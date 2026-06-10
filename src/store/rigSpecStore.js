import { create } from 'zustand';
import { useProjectStore } from './projectStore.js';
import { useParamValuesStore } from './paramValuesStore.js';
import { useRigEvalStore } from './rigEvalStore.js';
// Phase A2 (2026-05-09) — `initializeRigFromProject` and `loadProjectTextures`
// are dynamically imported inside `buildRigSpec` so the eager bundle stops
// dragging the cmo3/moc3/can3 binary writers + exporter graph (~60-80 kB
// gzip). The fast-path `selectRigSpec(project)` covers loaded projects
// without needing the heavy harvest at all; the async path is the
// fallback for fresh PSDs that haven't been Init-Rig'd yet.
import { gatherPhysicsRules } from '../io/live2d/rig/physicsConfig.js';
import { selectRigSpec } from '../io/live2d/rig/selectRigSpec.js';
import { sanitisePartName } from '../lib/partId.js';
import { logger } from '../lib/logger.js';
import { isBoneGroup, getMesh } from './objectDataAccess.js';

/**
 * Attach the runtime physics rule list onto a rigSpec. Single source
 * of truth — both `buildRigSpec` and `RigService.initializeRig` write
 * via this helper so the two attach sites never silently diverge on
 * gather options or post-seed project shape (Phase 3 cleanup,
 * 2026-06-08).
 *
 * @param {object|null} rigSpec
 * @param {object} project
 * @returns {object|null}
 */
export function attachPhysicsRulesToRigSpec(rigSpec, project) {
  if (!rigSpec) return rigSpec;
  return { ...rigSpec, physicsRules: gatherPhysicsRules(project) };
}

/**
 * v2 R1 — RigSpec session cache.
 *
 * Holds the current `rigSpec` (the shape consumed by the v2 evaluator
 * pipeline R2-R5) for the loaded project. Distinct from the persisted
 * `project.faceParallax / bodyWarp / rigWarps` keyform stores: those
 * carry deltas across saves, while this cache is the *full computed
 * rig* (warp deformers + rotation deformers + art mesh keyforms +
 * parameters) needed for live render. Volatile — never persisted.
 *
 * Lifecycle:
 *   1. RigService.initializeRig (driven by v3 ParametersEditor's
 *      "Initialize Rig" button) seeds the project AND populates this
 *      cache from the same harvest pass — single one-shot.
 *   2. CanvasViewport reads `rigSpec` per frame via the evaluator (R6).
 *   3. Project mesh edits bump `versionControl.geometryVersion` — the
 *      auto-subscribe below marks the cache stale (`rigSpec → null`).
 *   4. Next read sees `rigSpec === null` and either kicks a rebuild or
 *      falls back to inline render (R6's choice).
 *
 * `buildRigSpec()` is async because `initializeRigFromProject` runs
 * `generateCmo3` in `rigOnly` mode end-to-end. Single-flight: a second
 * call while already building is a no-op.
 *
 * **BFA-006 Phase 3.** When `project.nodes` already carries a complete
 * deformer graph (warp + rotation deformer nodes; populated by Init
 * Rig under Phase 3+ or by migration v15 + Init Rig once), the store
 * auto-populates `rigSpec` from `selectRigSpec(project)` on project
 * mutation — no async generator needed, no "click Init Rig to rebuild
 * after load" UX gap. The legacy async `buildRigSpec()` path stays as
 * the fallback for old projects where rotation deformer nodes haven't
 * been written yet (running it dual-writes them via `seedAllRig`).
 */
export const useRigSpecStore = create((set, get) => ({
  rigSpec: null,
  isBuilding: false,
  error: null,
  /** geometryVersion this rigSpec was built against. -1 when unbuilt. */
  lastBuiltGeometryVersion: -1,

  buildRigSpec: async () => {
    if (get().isBuilding) return get().rigSpec;

    // Phase 3 — fast path: if `selectRigSpec(project)` already
    // produces a complete rig (rotation deformers + artMeshes both
    // non-empty), use it directly. The async generator runs only
    // when the project's deformer graph is incomplete (= old project
    // not yet Init-Rig'd post Phase 3).
    const proj0 = useProjectStore.getState().project;
    const fast = selectRigSpec(proj0);
    if (_isComplete(fast, proj0)) {
      const v = useProjectStore.getState().versionControl?.geometryVersion ?? 0;
      // physicsRules already resolved inside selectRigSpec.
      set({
        rigSpec: fast,
        isBuilding: false,
        lastBuiltGeometryVersion: v,
        error: null,
      });
      _seedDefaultsForRig(fast, proj0);
      return fast;
    }

    set({ isBuilding: true, error: null });
    try {
      const project = useProjectStore.getState().project;
      // Phase A2 — dynamic imports keep the eager bundle off the .cmo3
      // writer / exporter graph; this path runs only for fresh PSDs
      // that haven't been Init-Rig'd yet.
      const [
        { initializeRigFromProject },
        { loadProjectTextures },
      ] = await Promise.all([
        import('../io/live2d/rig/initRig.js'),
        import('../io/imageHelpers.js'),
      ]);
      // Load textures so eye-source meshes get real PNG bytes for the
      // closure parabola fit. Non-fatal on failure.
      let images = new Map();
      try {
        images = await loadProjectTextures(project);
      } catch (_err) { /* proceed without */ }
      const harvest = await initializeRigFromProject(project, images);
      const v = useProjectStore.getState().versionControl?.geometryVersion ?? 0;
      // R9 — attach resolved physics rules so the runtime tick can
      // drive sway outputs without re-reading project state every
      // frame. initializeRigFromProject doesn't populate this itself
      // (physics rules live alongside the rig but aren't part of the
      // generator output); we resolve here from the post-seed project.
      let rigSpec = harvest.rigSpec ?? null;
      if (rigSpec) {
        const postSeedProject = useProjectStore.getState().project;
        rigSpec = attachPhysicsRulesToRigSpec(rigSpec, postSeedProject);
        _seedDefaultsForRig(rigSpec, postSeedProject);
      }
      set({
        rigSpec,
        isBuilding: false,
        lastBuiltGeometryVersion: v,
      });
      return rigSpec;
    } catch (err) {
      console.error('[rigSpecStore] buildRigSpec failed:', err);
      set({ isBuilding: false, error: err?.message ?? String(err) });
      return null;
    }
  },

  invalidate: () => {
    set({ rigSpec: null, lastBuiltGeometryVersion: -1, error: null });
    // PP2-010 — drop the live lifted-grid cache too; without this,
    // WarpDeformerOverlay would keep painting the previous rig's
    // lattices until the next eval pass on the new spec.
    useRigEvalStore.getState().setLiftedGrids(null);
  },
}));

/**
 * BFA-006 Phase 3+6 — a "complete" rigSpec is one whose owning project
 * has been Init-Rig'd at least once. The marker
 * `project.lastInitRigCompletedAt` (Hole I-8) is the canonical signal:
 * when set, `seedAllRig` has run and the deformer graph in
 * `project.nodes` is the source of truth, even if some slices are
 * legitimately empty (a character without head rotation has zero
 * `rotationDeformers`; a body-only model with no rigWarps has only
 * the body chain). The pre-fix gate required non-empty rotation +
 * artMesh slices, which mis-rejected those projects forever.
 *
 * Pre-Init-Rig projects (just imported from PSD; deformer nodes not
 * yet synthesised) fall through to the async generator.
 *
 * @param {object} rigSpec
 * @param {object} project
 */
function _isComplete(rigSpec, project) {
  if (!rigSpec) return false;
  if (!project?.lastInitRigCompletedAt) return false;
  // Defensive: a project with the completion marker set but zero
  // artMeshes is broken (no parts have mesh data); bail out so the
  // async path can re-derive.
  if (!Array.isArray(rigSpec.artMeshes) || rigSpec.artMeshes.length === 0) return false;
  return true;
}

/**
 * Build the bone-mirror registry: every bone group whose name matches a
 * `ParamRotation_<sanitisedBoneName>` param maps to that param.
 *
 * Two-way wiring after this runs:
 *   - PARAM → BONE: `setParamValue` / `setMany` fan out to `bone.pose.rotation`
 *     (the existing slider/physics path).
 *   - BONE → PARAM: CanvasViewport's pre-eval mirror reads
 *     `bone.pose.rotation` and writes to `valuesForEval[paramId]` so the
 *     Cubism warp evaluator deforms the mesh.
 *
 * # Pre-fix (2026-05-09 onward) — skinning-only gate
 *
 * The original heuristic required the bone to have an LBS-skinned part
 * (some `mesh.jointBoneId === bone.id && mesh.boneWeights`). The intent
 * was to scope the registry to bones that participate in Armature-modifier
 * skinning, which is correct for fresh post-RULE-№4 rigs where
 * `groupRotationToBone.js` auto-weights every migrated bone's children.
 *
 * # Why that broke for saved projects
 *
 * Older saves (and projects whose deformation flows through Cubism warps
 * rather than LBS) carry bones with a matching `ParamRotation_<bone>`
 * param but NO `jointBoneId / boneWeights` data on their child meshes.
 * The skinning gate rejected them; the registry stayed empty; the
 * BONE → PARAM mirror never fired; rotating those bones in pose mode
 * (or keying them in animation) left the warp evaluator reading the
 * default param value and the mesh stuck at rest pose.
 *
 * User report (Kora save, 2026-06-10): "I load Kora save and rotate her
 * bones — the bones don't move anything."
 *
 * # Post-fix — semantic gate
 *
 * The registry now includes EVERY bone group whose name matches a
 * `ParamRotation_<bone>` param. The matching param IS the wiring — the
 * Cubism warp evaluator already consumes `ParamRotation_<bone>`, so
 * mirroring the bone's pose into that param closes the bone-drives-mesh
 * loop whether the deformation is per-vertex skinning OR warp-based.
 *
 * Bones WITHOUT a matching param stay excluded — there's no parameter
 * for them to drive, so adding them to the registry would be a no-op
 * at best and a silent rotation churn at worst.
 */
function _buildBoneMirrorEntries(project) {
  const nodes = project?.nodes ?? [];
  const params = project?.parameters ?? [];
  const paramIds = new Set(params.map((p) => p?.id).filter(Boolean));
  const entries = [];
  for (const bone of nodes) {
    if (!isBoneGroup(bone)) continue;
    const sanitised = sanitisePartName(bone.name || bone.id);
    const paramId = `ParamRotation_${sanitised}`;
    if (paramIds.has(paramId)) entries.push({ paramId, boneId: bone.id });
  }
  return entries;
}

/**
 * Seed any params with non-zero defaults so the chain evaluator
 * doesn't read undefined for `ParamEyeLOpen=1` etc. (closes the
 * "freshly-loaded project: eyes closed" footgun). Doesn't overwrite
 * existing values.
 *
 * Also rebuilds the bone-mirror registry and syncs `bone.pose.rotation`
 * back into the values map. Both calls are idempotent — running them
 * on every rig-build settle point is fine.
 */
function _seedDefaultsForRig(rigSpec, project) {
  const params = rigSpec?.parameters?.length ? rigSpec.parameters : (project.parameters ?? []);
  if (params.length > 0) {
    useParamValuesStore.getState().seedMissingDefaults(params);
  }
  // Bone-mirror: rebuild from the current project shape, then pull each
  // bone's pose.rotation into the values map. After this returns,
  // chainEval reads paramValues for `ParamRotation_<bone>` and gets the
  // bone's actual rotation — even on a fresh load where the values map
  // had defaulted to 0 while bones carried real rotations from save.
  const entries = _buildBoneMirrorEntries(project);
  useParamValuesStore.getState().setBoneMirrorRegistry(entries);
  // Diagnostic — the BONE → PARAM mirror at viewport eval setup depends
  // entirely on these entries being populated. If a user reports
  // "bones don't move the layers", first thing to check is whether the
  // registry has the bone they're rotating. Log both the count and the
  // first few entries so the failure mode is obvious in the Logs panel.
  // Dedupe by signature so repeat re-seeds don't flood.
  const _sig = entries.map((e) => `${e.boneId}:${e.paramId}`).join(',');
  if (_sig !== _lastBoneMirrorSig) {
    _lastBoneMirrorSig = _sig;
    if (entries.length === 0) {
      // Investigate-mode help: list the bones we ARE seeing + the params
      // we ARE seeing so we can spot a naming mismatch from one log line.
      const nodes = project?.nodes ?? [];
      const params = project?.parameters ?? [];
      const bones = nodes.filter((n) => isBoneGroup(n));
      const boneNames = bones.map((b) => b.name || b.id).slice(0, 8);
      const rotParams = params
        .filter((p) => p?.id?.startsWith('ParamRotation_'))
        .map((p) => p.id)
        .slice(0, 8);
      logger.warn('boneMirror',
        `setBoneMirrorRegistry: 0 entries (${bones.length} bones, ${params.length} params; ${rotParams.length} ParamRotation_*)`,
        {
          boneCount: bones.length,
          boneNamesSample: boneNames,
          paramCount: params.length,
          rotationParamSample: rotParams,
          hint: rotParams.length === 0
            ? 'No ParamRotation_* params exist — bone-mirror requires init rig to create them. Click Initialize Rig.'
            : 'Bone names do not match ParamRotation_* param suffixes. Check sanitisePartName mapping.',
        });
    } else {
      logger.info('boneMirror',
        `setBoneMirrorRegistry: ${entries.length} entries`,
        {
          count: entries.length,
          sample: entries.slice(0, 6),
        });
    }
  }
  if (entries.length > 0) {
    useParamValuesStore.getState().syncFromProject();
  }

  // 2026-06-10 Kora "bones don't move layers" — once-per-rig diagnostic
  // for the OVERLAY path (the rigid-follow path that fires for parts
  // with NO bone weights but a bone-group ancestor in their parent
  // chain — v32's intended replacement for the stripped rigid-1.0
  // weights). When the user reports "rotating bone X doesn't deform
  // the mesh", what we need to know is: (a) does bone X have any
  // descendant parts in the parent chain? and (b) what composition
  // path does each part take (LBS / overlay / none)? Without (a)
  // the overlay can't fire — the parts aren't structurally tied to
  // the bone, no matter what my BONE → PARAM mirror does.
  //
  // Single-pass diagnostic; dedupe by rig-shape signature to avoid
  // flooding on repeat re-seeds.
  if (_lastBoneAncestorDiagSig !== _sig) {
    _lastBoneAncestorDiagSig = _sig;
    try {
      const nodes = project?.nodes ?? [];
      const byId = new Map();
      for (const n of nodes) if (n?.id) byId.set(n.id, n);
      const bones = nodes.filter((n) => isBoneGroup(n));
      /** @type {Map<string, {name: string, descendantParts: number, lbsParts: number, overlayParts: number}>} */
      const perBone = new Map();
      for (const b of bones) {
        perBone.set(b.id, {
          name: b.name || b.id,
          descendantParts: 0,
          lbsParts: 0,
          overlayParts: 0,
        });
      }
      let partsWithBoneAncestor = 0;
      let partsWithoutBoneAncestor = 0;
      let partsLbs = 0;
      let partsOverlay = 0;
      let partsNone = 0;
      for (const n of nodes) {
        if (n?.type !== 'part') continue;
        // Walk parent chain to find nearest bone.
        let cur = n.parent ? byId.get(n.parent) : null;
        const seen = new Set();
        let ancestorBoneId = null;
        while (cur && !seen.has(cur)) {
          seen.add(cur);
          if (isBoneGroup(cur)) { ancestorBoneId = cur.id; break; }
          cur = cur.parent ? byId.get(cur.parent) : null;
        }
        if (ancestorBoneId) partsWithBoneAncestor++;
        else partsWithoutBoneAncestor++;

        // Check mesh weight presence (LBS path). Route through getMesh
        // so v18 dataId-split parts resolve correctly.
        const m = getMesh(n, project);
        const hasWeights = Array.isArray(m?.boneWeights) && m.boneWeights.length > 0;
        if (hasWeights) {
          partsLbs++;
          if (ancestorBoneId && perBone.has(ancestorBoneId)) {
            perBone.get(ancestorBoneId).lbsParts++;
          }
        } else if (ancestorBoneId) {
          partsOverlay++;
          if (perBone.has(ancestorBoneId)) {
            perBone.get(ancestorBoneId).overlayParts++;
          }
        } else {
          partsNone++;
        }

        if (ancestorBoneId && perBone.has(ancestorBoneId)) {
          perBone.get(ancestorBoneId).descendantParts++;
        }
      }
      /** @type {Array<{boneId:string, name:string, descendantParts:number, lbsParts:number, overlayParts:number}>} */
      const perBoneSummary = [];
      for (const [boneId, stats] of perBone) {
        if (stats.descendantParts > 0) {
          perBoneSummary.push({ boneId, ...stats });
        }
      }
      const unwiredBones = [];
      for (const [boneId, stats] of perBone) {
        if (stats.descendantParts === 0) {
          unwiredBones.push(stats.name);
        }
      }
      logger.info('boneAncestorDiag',
        `bone→part chain audit: ${partsWithBoneAncestor}/${partsWithBoneAncestor + partsWithoutBoneAncestor} parts have bone ancestor (lbs=${partsLbs}, overlay=${partsOverlay}, none=${partsNone})`,
        {
          totalBones: bones.length,
          bonesWithDescendants: perBoneSummary.length,
          bonesWithoutDescendants: unwiredBones.length,
          unwiredBoneNamesSample: unwiredBones.slice(0, 8),
          perBoneSample: perBoneSummary.slice(0, 8),
          hint: partsWithoutBoneAncestor > 0 || unwiredBones.length > 0
            ? 'Parts without bone ancestor OR bones with 0 descendant parts → overlay path cannot fire. Rotating those bones in pose mode will not deform the mesh — the structural parent chain doesn\'t connect them.'
            : 'Every part has a bone ancestor; overlay path should fire on bone rotation.',
        });
    } catch (err) {
      logger.warn('boneAncestorDiag', `audit threw: ${String(err)}`, { error: String(err) });
    }
  }
}

// Auto-invalidate on geometry edits. Listens for `versionControl.geometryVersion`
// bumps from projectStore and drops the cache if the stored version no longer
// matches what the rigSpec was built against.
//
// Triggers covered: mesh vertex moves, retriangulate, PSD reimport, blend
// shape edits, puppet pin add/remove. Tag changes don't bump geometry but
// usually accompany a mesh re-emission — Initialize-Rig click is the
// canonical re-build path either way.
/** Dedupe signature for the boneMirror diagnostic log. */
let _lastBoneMirrorSig = null;
/** Dedupe signature for the bone-ancestor diagnostic log. */
let _lastBoneAncestorDiagSig = null;

let _prevGeometryVersion = useProjectStore.getState().versionControl?.geometryVersion ?? 0;
useProjectStore.subscribe((state) => {
  const cur = state.versionControl?.geometryVersion ?? 0;
  if (cur === _prevGeometryVersion) return;
  _prevGeometryVersion = cur;
  const { rigSpec, lastBuiltGeometryVersion } = useRigSpecStore.getState();
  if (rigSpec && cur !== lastBuiltGeometryVersion) {
    useRigSpecStore.getState().invalidate();
  }
});

// Phase 3 — auto-populate `rigSpec` from `selectRigSpec(project)` on
// every project mutation. `selectRigSpec` is memoized by project
// identity (WeakMap) so re-running it across renders that don't
// change the project is O(1); for genuine mutations the recompute is
// the price of correctness.
//
// Pre-2026-05-08 this subscriber was one-shot — it bailed out when
// rigSpec was already set, which closed the "click Init Rig to
// rebuild after load" gap but ALSO meant any post-Init-Rig project
// mutation that doesn't bump `versionControl.geometryVersion`
// (modifier toggle, mode-bit chip, modifier reorder, binding edit,
// parameter add) silently failed to refresh the cached rigSpec. Live
// Preview kept showing the stale chain. Lifting the guard lets the
// modifier-disable + mode-bitmask gating in `synthesizeDeformerNodesForExport`
// + `selectRigSpec._buildArtMeshes` actually reach the renderer.
let _lastSeenProject = null;
let _lastSkipReasonsKey = null;
let _lastOkSignature = null;
useProjectStore.subscribe((state) => {
  const project = state.project;
  if (project === _lastSeenProject) return;
  _lastSeenProject = project;
  const { isBuilding } = useRigSpecStore.getState();
  if (isBuilding) return;
  const fast = selectRigSpec(project);
  // BUG-023 instrumentation — log why the auto-fill skipped vs populated
  // so we can diagnose post-load "rig is dead" reports without ambiguity.
  // Dedupe by reasons key so dragging during the wizard's adjust-joints
  // step (which mutates project on every mousemove without changing the
  // skip reasons) doesn't flood the log.
  if (!_isComplete(fast, project)) {
    const reasons = [];
    if (!project?.lastInitRigCompletedAt) reasons.push('no-lastInitRigCompletedAt');
    if (!Array.isArray(fast?.artMeshes) || fast.artMeshes.length === 0) reasons.push('empty-artMeshes');
    const key = reasons.join(',');
    if (key !== _lastSkipReasonsKey) {
      _lastSkipReasonsKey = key;
      logger.warn('rigSpecPostLoad', `auto-fill SKIPPED: ${reasons.join(', ')}`, {
        reasons,
        lastInitRigCompletedAt: project?.lastInitRigCompletedAt ?? null,
        artMeshCount: fast?.artMeshes?.length ?? 0,
        warpCount: fast?.warpDeformers?.length ?? 0,
        rotationCount: fast?.rotationDeformers?.length ?? 0,
      });
    }
    return;
  }
  _lastSkipReasonsKey = null;
  const v = state.versionControl?.geometryVersion ?? 0;
  useRigSpecStore.setState({
    rigSpec: fast,
    isBuilding: false,
    lastBuiltGeometryVersion: v,
    error: null,
  });
  _seedDefaultsForRig(fast, project);
  // Log only when the rig's structural signature changes — this
  // subscriber fires on every project mutation (slider drag, mesh
  // edit, etc.) post the 2026-05-08 lift of the one-shot guard, and
  // logging every tick would flood the panel.
  const okSig = `${fast.warpDeformers.length}w/${fast.rotationDeformers.length}r/${fast.artMeshes.length}m/${fast.parameters?.length ?? 0}p`;
  if (okSig !== _lastOkSignature) {
    _lastOkSignature = okSig;
    logger.info('rigSpecPostLoad', `auto-fill OK: ${okSig}`, {
      warpCount: fast.warpDeformers.length,
      rotationCount: fast.rotationDeformers.length,
      artMeshCount: fast.artMeshes.length,
      paramCount: fast.parameters?.length ?? 0,
    });
  }
});
