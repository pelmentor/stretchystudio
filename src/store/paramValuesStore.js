// @ts-check
import { create } from 'zustand';
import { logger } from '../lib/logger.js';

/**
 * R0 (Native rig render v2) — live parameter values driving in-editor evaluation.
 *
 * Distinct from `project.parameters` (the persisted *spec* — id, range,
 * default) and from animation keyframes (which write into `draftPose` /
 * keyframe channels). This store is the *current dial position* of every
 * runnable param, edited via Parameters panel sliders and read by the
 * CanvasViewport tick to feed the rig evaluator.
 *
 * Plain object (not Map) — Zustand needs a fresh reference for each update,
 * so consumers re-run effects on `{...values, [id]: v}`.
 */
export const useParamValuesStore = create((set) => ({
  values: {},

  setParamValue: (id, value) =>
    set(state => ({ values: { ...state.values, [id]: value } })),

  setMany: (updates) =>
    set(state => ({ values: { ...state.values, ...updates } })),

  resetToDefaults: (parameters) => {
    const next = {};
    for (const p of parameters ?? []) {
      next[p.id] = p.default ?? 0;
    }
    set({ values: next });
    logger.info('paramSeed', `resetToDefaults: ${Object.keys(next).length} param(s)`, {
      // Light snapshot of non-zero defaults — those are the dial positions
      // a fresh load needs to render correctly (eyes open, mouth shut, etc.).
      nonZeroDefaults: Object.fromEntries(
        Object.entries(next).filter(([, v]) => v !== 0),
      ),
    });
  },

  /**
   * Seed parameters that aren't yet in the values map with their
   * canonical default. Does NOT overwrite existing entries — used by
   * project-load + rig-build paths that need to ensure params have
   * SOME value without clobbering user edits.
   *
   * Without this, a freshly-loaded project (or imported cmo3) leaves
   * paramValues empty, and chainEval reads `undefined` for every
   * binding → cellSelect treats undefined as 0 → params with default≠0
   * (`ParamEyeLOpen=1`, `ParamEyeROpen=1`) render at 0 (eyes shut)
   * until the user touches the slider.
   *
   * @param {Array<{id:string, default?:number}> | undefined} parameters
   */
  seedMissingDefaults: (parameters) =>
    set(state => {
      const merged = { ...state.values };
      const added = [];
      for (const p of parameters ?? []) {
        if (!(p.id in merged)) {
          merged[p.id] = p.default ?? 0;
          added.push(p.id);
        }
      }
      if (added.length > 0) {
        logger.info('paramSeed', `seedMissingDefaults: +${added.length} new`, {
          added,
          alreadyHad: Object.keys(state.values).length,
        });
        return { values: merged };
      }
      return state;
    }),

  reset: () => set({ values: {} }),
}));
