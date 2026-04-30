import { create } from 'zustand';
import { useProjectStore } from './projectStore.js';
import { useParamValuesStore } from './paramValuesStore.js';
import { initializeRigFromProject } from '../io/live2d/rig/initRig.js';
import { resolvePhysicsRules } from '../io/live2d/rig/physicsConfig.js';

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
 */
export const useRigSpecStore = create((set, get) => ({
  rigSpec: null,
  isBuilding: false,
  error: null,
  /** geometryVersion this rigSpec was built against. -1 when unbuilt. */
  lastBuiltGeometryVersion: -1,

  buildRigSpec: async () => {
    if (get().isBuilding) return get().rigSpec;
    set({ isBuilding: true, error: null });
    try {
      const project = useProjectStore.getState().project;
      const harvest = await initializeRigFromProject(project);
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
        // Ensure every spec'd parameter has SOME value in paramValues —
        // otherwise the chain evaluator reads `undefined` for params
        // with non-zero defaults (`ParamEyeLOpen=1`, etc.) and renders
        // them at 0 (eyes closed on freshly-loaded projects). Doesn't
        // overwrite existing values, so in-flight slider edits survive.
        const params = rigSpec.parameters?.length
          ? rigSpec.parameters
          : (postSeedProject.parameters ?? []);
        useParamValuesStore.getState().seedMissingDefaults(params);
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

  invalidate: () => set({ rigSpec: null, lastBuiltGeometryVersion: -1, error: null }),
}));

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
