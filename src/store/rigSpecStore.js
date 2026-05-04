import { create } from 'zustand';
import { useProjectStore } from './projectStore.js';
import { useParamValuesStore } from './paramValuesStore.js';
import { useRigEvalStore } from './rigEvalStore.js';
import { initializeRigFromProject } from '../io/live2d/rig/initRig.js';
import { resolvePhysicsRules } from '../io/live2d/rig/physicsConfig.js';
import { selectRigSpec } from '../io/live2d/rig/selectRigSpec.js';
import { loadProjectTextures } from '../io/imageHelpers.js';

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
    if (_isComplete(fast)) {
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
 * BFA-006 Phase 3 — a "complete" rigSpec has both rotation deformers
 * AND artMeshes populated. Pre-Phase-3 projects (sidetables only;
 * never Init-Rig'd under Phase 3) produce partial output that selects
 * to empty rotations / artMeshes — we fall through to the async
 * builder for those.
 */
function _isComplete(rigSpec) {
  if (!rigSpec) return false;
  if (!Array.isArray(rigSpec.rotationDeformers) || rigSpec.rotationDeformers.length === 0) return false;
  if (!Array.isArray(rigSpec.artMeshes) || rigSpec.artMeshes.length === 0) return false;
  return true;
}

/**
 * Seed any params with non-zero defaults so the chain evaluator
 * doesn't read undefined for `ParamEyeLOpen=1` etc. (closes the
 * "freshly-loaded project: eyes closed" footgun). Doesn't overwrite
 * existing values.
 */
function _seedDefaultsForRig(rigSpec, project) {
  const params = rigSpec?.parameters?.length ? rigSpec.parameters : (project.parameters ?? []);
  if (params.length > 0) {
    useParamValuesStore.getState().seedMissingDefaults(params);
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

// Phase 3 — auto-populate `rigSpec` from `selectRigSpec(project)` when
// the project mutates and the deformer graph is complete. Runs ONCE
// per project identity (the WeakMap inside selectRigSpec memoizes,
// so the same project re-tested across many renders is cheap).
//
// This is what closes the "click Init Rig to rebuild after load" gap:
// project load → projectStore subscribe fires → if the loaded project
// already has rotation + warp + part-mesh nodes (= Init Rig was run
// in a previous session post Phase 3), rigSpec auto-fills with no
// async pass.
let _lastSeenProject = null;
useProjectStore.subscribe((state) => {
  const project = state.project;
  if (project === _lastSeenProject) return;
  _lastSeenProject = project;
  const { rigSpec, isBuilding } = useRigSpecStore.getState();
  if (rigSpec || isBuilding) return;
  const fast = selectRigSpec(project);
  if (!_isComplete(fast)) return;
  const v = state.versionControl?.geometryVersion ?? 0;
  useRigSpecStore.setState({
    rigSpec: fast,
    isBuilding: false,
    lastBuiltGeometryVersion: v,
    error: null,
  });
  _seedDefaultsForRig(fast, project);
});
