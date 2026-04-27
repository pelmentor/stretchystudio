import { create } from 'zustand';
import { useProjectStore } from './projectStore';
import { initializeRigFromProject } from '@/io/live2d/rig/initRig';

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
 *   1. ParametersPanel "Initialize Rig" calls `buildRigSpec()` after
 *      seeding (one-shot; harvest + cache built from same generator run).
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
      set({
        rigSpec: harvest.rigSpec ?? null,
        isBuilding: false,
        lastBuiltGeometryVersion: v,
      });
      return harvest.rigSpec ?? null;
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
