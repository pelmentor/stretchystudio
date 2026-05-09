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
import { resolvePhysicsRules } from '../io/live2d/rig/physicsConfig.js';
import { selectRigSpec } from '../io/live2d/rig/selectRigSpec.js';
import { sanitisePartName } from '../lib/partId.js';
import { logger } from '../lib/logger.js';
import { getMesh } from './objectDataAccess.js';

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
        rigSpec = { ...rigSpec, physicsRules: resolvePhysicsRules(postSeedProject) };
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
 * Build the bone-mirror registry: every `ParamRotation_<sanitisedBoneName>`
 * whose corresponding bone has skinning data (jointBoneId on a mesh) maps
 * to its bone group's id. After this runs, `setParamValue` /
 * `setMany` fan out to `bone.pose.rotation`, and `syncFromProject` can
 * reconcile after direct bone mutations.
 *
 * Includes only the per-bone rotation params (paramSpec.js section 5 —
 * limb bones with skinning data). Per-group rotation params (section 6 —
 * front_hair, top_wear etc.) drive non-skeletal rotation deformers and
 * have no bone counterpart; left out of the registry intentionally.
 */
function _buildBoneMirrorEntries(project) {
  const nodes = project?.nodes ?? [];
  const params = project?.parameters ?? [];
  const paramIds = new Set(params.map((p) => p?.id).filter(Boolean));
  /** @type {Set<string>} */
  const boneIdsWithSkinning = new Set();
  for (const n of nodes) {
    if (n?.type !== 'part') continue;
    const m = getMesh(n, project);
    if (m?.jointBoneId && m?.boneWeights) {
      boneIdsWithSkinning.add(m.jointBoneId);
    }
  }
  const entries = [];
  for (const boneId of boneIdsWithSkinning) {
    const bone = nodes.find((n) => n.id === boneId);
    if (!bone) continue;
    const sanitised = sanitisePartName(bone.name || bone.id);
    const paramId = `ParamRotation_${sanitised}`;
    if (paramIds.has(paramId)) entries.push({ paramId, boneId });
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
  if (entries.length > 0) {
    useParamValuesStore.getState().syncFromProject();
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
