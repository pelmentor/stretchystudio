// @ts-check
import { create } from 'zustand';
import { logger } from '../lib/logger.js';
import { useProjectStore } from './projectStore.js';
import { setBonePoseField, getBonePose } from './objectDataAccess.js';

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
 *
 * ## Bone-mirror params (2026-05-06)
 *
 * For limb bones with skinning data (jointBoneId in some mesh), the auto-
 * rig synthesises `ParamRotation_<sanitisedBoneName>`. Pre-2026-05-06 these
 * params were the SOLE storage for the bone's rotation; the bone's own
 * `pose.rotation` slot stayed at 0 and Pose-Mode arc drag silently moved
 * a slider instead of rotating the bone. That broke `applyPoseAsRest`
 * (which only bakes non-identity bone matrices) and confused the user
 * because Pose Mode wasn't acting like Blender's Pose Mode.
 *
 * After this refactor, `bone.pose.rotation` is the canonical store. The
 * `ParamRotation_<bone>` param is a **mirror** kept in sync via:
 *  - `setParamValue(id, v)` — if `id` is in the bone-mirror registry, the
 *    setter writes BOTH `bone.pose.rotation = v` AND `values[id] = v` in
 *    one atomic operation.
 *  - `setMany(updates)` — same fan-out per entry.
 *  - Direct mutations of `bone.pose.rotation` (e.g., `applyPoseAsRest`,
 *    project load) call `syncFromProject()` after the mutation to refresh
 *    the mirror values.
 *
 * Consumers of `paramValues.values[id]` (chainEval, art mesh keyforms,
 * deformer overlays, motion3 export, animation eval) read the mirror map
 * unchanged — the bone is invisible to them. Export pipeline emits the
 * same `<CParameterSource>` + keyforms as before; byte-identical output.
 *
 * Plan: docs/plans/BONE_ROTATION_CANONICAL.md.
 */
export const useParamValuesStore = create((set, get) => ({
  values: {},

  /** Bone-mirror registry. Two parallel maps for fast bidirectional lookup.
   *  Populated by `setBoneMirrorRegistry` after Init Rig completion (or on
   *  fast-path load via `_seedDefaultsForRig` in rigSpecStore.js). */
  boneMirror: {
    byParam: new Map(),  // paramId → boneId
    byBone:  new Map(),  // boneId  → paramId
  },

  /**
   * @param {string} id
   * @param {number} value
   * @param {{ skipBoneMirror?: boolean }} [opts]
   *   `skipBoneMirror: true` — runtime/automatic writes (physics tick,
   *   animation playback) bypass the bone fan-out so they don't churn
   *   projectStore every frame. User authoring writes (arc drag, slider)
   *   leave it false → bone.pose.rotation is updated.
   */
  setParamValue: (id, value, opts) => {
    // BUG-015 instrumentation — surface BodyAngle slider writes so we can
    // confirm the slider→store path is hot when the user drags in
    // Live Preview. Throttled at the call site (one log per change is
    // fine — a drag emits ~5-15 onValueChange events / sec).
    if (id === 'ParamBodyAngleX' || id === 'ParamBodyAngleY' || id === 'ParamBodyAngleZ') {
      logger.debug('paramSet', `${id} → ${value}`, { id, value });
    }
    const skipBoneMirror = opts?.skipBoneMirror === true;
    const boneId = !skipBoneMirror ? get().boneMirror.byParam.get(id) : undefined;
    if (boneId) {
      // Fan out: bone.pose.rotation is canonical; values map mirrors it
      // for read consistency. Single skipHistory write so arc-drag scrubs
      // don't pollute undo.
      useProjectStore.getState().updateProject((proj) => {
        const bone = proj.nodes.find((n) => n.id === boneId);
        setBonePoseField(bone, 'rotation', value);
      }, { skipHistory: true });
    }
    set(state => ({ values: { ...state.values, [id]: value } }));
  },

  /**
   * Same `skipBoneMirror` opt as `setParamValue`.
   * @param {Object<string, number>} updates
   * @param {{ skipBoneMirror?: boolean }} [opts]
   */
  setMany: (updates, opts) => {
    const skipBoneMirror = opts?.skipBoneMirror === true;
    if (!skipBoneMirror) {
      const reg = get().boneMirror.byParam;
      // Collect bone fan-outs first; commit in one updateProject call to
      // keep the immer batch tight and avoid N re-renders.
      const boneFanOut = [];
      for (const id of Object.keys(updates)) {
        const boneId = reg.get(id);
        if (boneId) boneFanOut.push({ boneId, value: updates[id] });
      }
      if (boneFanOut.length > 0) {
        useProjectStore.getState().updateProject((proj) => {
          for (const { boneId, value } of boneFanOut) {
            const bone = proj.nodes.find((n) => n.id === boneId);
            setBonePoseField(bone, 'rotation', value);
          }
        }, { skipHistory: true });
      }
    }
    set(state => ({ values: { ...state.values, ...updates } }));
  },

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

  /**
   * Replace the bone-mirror registry. Called from `_seedDefaultsForRig`
   * (rigSpecStore.js) after Init Rig or fast-path load — exactly the
   * moment when `project.parameters` and the bone graph are both stable.
   *
   * @param {Array<{paramId: string, boneId: string}>} entries
   */
  setBoneMirrorRegistry: (entries) => {
    const byParam = new Map();
    const byBone = new Map();
    for (const e of entries ?? []) {
      if (!e?.paramId || !e?.boneId) continue;
      byParam.set(e.paramId, e.boneId);
      byBone.set(e.boneId, e.paramId);
    }
    set({ boneMirror: { byParam, byBone } });
  },

  /**
   * Re-read every bone-mirror param's value from `bone.pose.rotation`
   * and refresh the `values` map. Call after any direct mutation of
   * bones that bypasses `setParamValue`/`setMany`:
   *  - `applyPoseAsRest` (zeroes all bone poses)
   *  - Project load (paramValues seeded from defaults; bones carry
   *    real rotations from save → without this, the values map shows
   *    0 while bones are mid-rotation, mis-rendering until first
   *    arc-drag).
   *  - Migration paths.
   */
  syncFromProject: () => {
    const state = get();
    const proj = useProjectStore.getState().project;
    if (!proj?.nodes) return;
    const byBone = state.boneMirror.byBone;
    if (byBone.size === 0) return;
    const next = { ...state.values };
    let dirty = false;
    for (const [boneId, paramId] of byBone) {
      const bone = proj.nodes.find((n) => n.id === boneId);
      // getBonePose handles v17/v18 flat shape AND v19 channels shape;
      // returns identity-pose for missing/unposed bones.
      const r = getBonePose(bone)?.rotation ?? 0;
      if (next[paramId] !== r) {
        next[paramId] = r;
        dirty = true;
      }
    }
    if (dirty) set({ values: next });
  },

  reset: () => set({ values: {}, boneMirror: { byParam: new Map(), byBone: new Map() } }),
}));
