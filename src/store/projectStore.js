import { create } from 'zustand';
import { produce } from 'immer';
import { pushSnapshot, isBatching, clearHistory } from './undoHistory.js';
import { useParamValuesStore } from './paramValuesStore.js';
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
  ensureWeightGroups,
  syncBoneWeightsFromActive,
  applyWeightStroke,
} from '../io/live2d/rig/meshSync.js';
import {
  getMesh,
  isMeshedPart,
  isBoneGroup,
  setObjectMode,
} from './objectDataAccess.js';
import {
  rotationSpecToDeformerNode,
  warpSpecToDeformerNode,
  upsertDeformerNode,
  removeAllRotationDeformerNodes,
  synthesizeModifierStacks,
  synthesizeDeformerParents,
} from './deformerNodeSync.js';
import { persistArtMeshRuntime } from './artMeshRuntimeSync.js';
import { seedDefaultRigidWeights } from './seedDefaultRigidWeights.js';
import { findOrphanReferences } from '../io/live2d/rig/paramReferences.js';
import { findBindingSchemaDrift } from '../io/live2d/rig/paramSchemaDrift.js';
import { logger } from '../lib/logger.js';
import { uid } from '../lib/ids.js';
import { coerceNumberArray } from '../lib/numberArrayCoerce.js';
import { computeWorldMatrices } from '../renderer/transforms.js';

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
    // BFA-006 Phase 6 — legacy `faceParallax` / `bodyWarp` / `rigWarps`
    // sidetables deleted. Deformers now live in `project.nodes` as
    // `type:'deformer'` entries; the body warp's layout + debug
    // metadata persists here in the small `bodyWarpLayout` sidetable
    // (the canvas→innermost normalizer closures need persisted
    // ranges that can't be recovered from baseGrids alone).
    bodyWarpLayout: null,
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
   *
   * BVR-006 — validates against cycles + obviously-bad type pairings:
   *   - reparent to self → no-op
   *   - reparent to a descendant (cycle) → no-op
   *   - bone → part parent → no-op (parts can't own bones)
   *
   * Pushes an undo snapshot ON SUCCESS only — rejected reparents
   * (cycle / dangling / type mismatch) are no-ops and don't pollute
   * the undo stack. Exposed as a user gesture by BVR-006 (Outliner
   * drag-reparent), so a misplaced drop now has a clean Ctrl+Z path.
   *
   * Returns nothing; caller can read `project.nodes` after to verify.
   */
  reparentNode: (nodeId, newParentId) => set((state) => {
    const nodes = state.project.nodes;
    if (!Array.isArray(nodes)) return state;
    const node = nodes.find((n) => n?.id === nodeId);
    if (!node) return state;
    if (newParentId === nodeId) return state; // self-parenting
    const newParent = newParentId ? (nodes.find((n) => n?.id === newParentId) ?? null) : null;
    if (newParentId && !newParent) return state; // dangling target
    // Cycle: walk newParent's ancestry; if nodeId appears anywhere, reject.
    if (newParent) {
      let cursor = /** @type {any} */ (newParent);
      const guard = new Set();
      while (cursor) {
        if (cursor.id === nodeId) return state;
        if (guard.has(cursor.id)) break;
        guard.add(cursor.id);
        cursor = cursor.parent ? nodes.find((n) => n?.id === cursor.parent) : null;
      }
    }
    // Type compatibility: bones can't be children of parts (parts have
    // no skeleton role, can't own bones). Other pairings are permitted —
    // a part under another part is rare but legal (PSD layer convention).
    const isBone = node.type === 'group' && !!node.boneRole;
    if (isBone && newParent && newParent.type === 'part') return state;
    // No-op short-circuit: parent already correct.
    if ((node.parent ?? null) === (newParentId ?? null)) return state;
    // Validation passed — snapshot for undo, then mutate.
    if (!isBatching()) pushSnapshot(state.project);
    return produce(state, (draft) => {
      const n = draft.project.nodes.find((nn) => nn?.id === nodeId);
      if (n) n.parent = newParentId ?? null;
      draft.hasUnsavedChanges = true;
      draft.versionControl.transformVersion++;
    });
  }),
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
    const mesh = getMesh(node, state.project);
    if (!mesh) return;
    const id = uid();
    const deltas = mesh.vertices.map(() => ({ dx: 0, dy: 0 }));
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

  // ── Parameter CRUD (V4 Phase 2 — Param editor polish) ────────────
  // All actions write through the immer recipe so they're undoable.
  // Mutations stamp `_userAuthored: true` so the entry survives Init
  // Rig 'merge' (paramSpec.seedParameters honours the marker).
  // Cascading remove/rename walks every place a paramId can appear:
  //   - deformer node bindings (`node.bindings[].parameterId`)
  //   - animation tracks (`anim.tracks[].paramId`)
  //   - physics rules (`rule.inputs[].paramId`)
  // Keyforms aren't expanded/collapsed on key add/remove — that's
  // Track 3 (Keyform editor) territory; keys stored on the param drive
  // the next Init Rig regen, and the existing keyforms stay until then.

  /**
   * Add a new parameter. Stamps `_userAuthored: true` so the entry
   * survives Init Rig 'merge'. Returns true on success, false if the
   * id collides with an existing param.
   *
   * @param {{
   *   id: string,
   *   name?: string,
   *   role?: string,
   *   min?: number,
   *   max?: number,
   *   default?: number,
   *   decimalPlaces?: number,
   *   keys?: number[],
   * }} spec
   */
  addParameter: (spec) => {
    if (!spec || typeof spec.id !== 'string' || spec.id.length === 0) return false;
    const params = get().project?.parameters ?? [];
    if (params.some((p) => p?.id === spec.id)) return false;
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const min = typeof spec.min === 'number' ? spec.min : 0;
      const max = typeof spec.max === 'number' ? spec.max : 1;
      const def = typeof spec.default === 'number' ? spec.default : Math.min(Math.max(0, min), max);
      const keys = coerceNumberArray(spec.keys, `addParameter[${spec.id}].keys`);
      state.project.parameters = state.project.parameters ?? [];
      state.project.parameters.push({
        id:   spec.id,
        name: spec.name ?? spec.id,
        role: spec.role ?? 'custom',
        min,
        max,
        default: def,
        decimalPlaces: typeof spec.decimalPlaces === 'number' ? spec.decimalPlaces : 2,
        keys,
        _userAuthored: true,
        _userAuthoredKeys: keys.slice(),
      });
    }));
    return true;
  },

  /**
   * Remove a parameter and cascade-drop every reference. Drops:
   *   - matching deformer bindings
   *   - matching animation tracks
   *   - matching physics rule inputs
   * Existing keyforms whose keyTuple includes a key on the dropped
   * param are NOT touched — they're left orphan in the deformer node
   * and Init Rig regenerates them on the next pass. (See V4 plan §4
   * Risks — keyform editor track owns the live collapse.)
   */
  removeParameter: (paramId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const proj = state.project;
    proj.parameters = (proj.parameters ?? []).filter((p) => p?.id !== paramId);
    for (const n of proj.nodes ?? []) {
      if (n?.type !== 'deformer' || !Array.isArray(n.bindings)) continue;
      n.bindings = n.bindings.filter((b) => b?.parameterId !== paramId);
    }
    for (const anim of proj.animations ?? []) {
      if (!Array.isArray(anim?.tracks)) continue;
      anim.tracks = anim.tracks.filter((t) => t?.paramId !== paramId);
    }
    for (const rule of proj.physicsRules ?? []) {
      if (!Array.isArray(rule?.inputs)) continue;
      rule.inputs = rule.inputs.filter((inp) => inp?.paramId !== paramId);
    }
  })),

  /**
   * Rename a parameter id. Cascades the rename through deformer
   * bindings, animation tracks, and physics rule inputs. No-op if
   * `oldId === newId`. Returns false if `newId` collides with another
   * existing param. Stamps `_userAuthored: true` on the renamed entry.
   */
  renameParameter: (oldId, newId) => {
    if (typeof oldId !== 'string' || typeof newId !== 'string') return false;
    if (newId.length === 0) return false;
    if (oldId === newId) return true;
    const params = get().project?.parameters ?? [];
    if (params.some((p) => p?.id === newId)) return false;
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const proj = state.project;
      const param = (proj.parameters ?? []).find((p) => p?.id === oldId);
      if (!param) return;
      param.id = newId;
      param._userAuthored = true;
      for (const n of proj.nodes ?? []) {
        if (n?.type !== 'deformer' || !Array.isArray(n.bindings)) continue;
        for (const b of n.bindings) {
          if (b?.parameterId === oldId) b.parameterId = newId;
        }
      }
      for (const anim of proj.animations ?? []) {
        for (const t of anim?.tracks ?? []) {
          if (t?.paramId === oldId) t.paramId = newId;
        }
      }
      for (const rule of proj.physicsRules ?? []) {
        for (const inp of rule?.inputs ?? []) {
          if (inp?.paramId === oldId) inp.paramId = newId;
        }
      }
    }));
    return true;
  },

  /**
   * Patch fields on an existing parameter. Whitelisted fields only:
   * name, min, max, default, decimalPlaces, role. Stamps
   * `_userAuthored: true` on first patch. No cascade — just field
   * edits.
   */
  patchParameter: (paramId, partial) => set(produce((state) => {
    if (!partial || typeof partial !== 'object') return;
    state.hasUnsavedChanges = true;
    const param = (state.project.parameters ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    if (typeof partial.name === 'string')          param.name = partial.name;
    if (typeof partial.role === 'string')          param.role = partial.role;
    if (typeof partial.min === 'number')           param.min = partial.min;
    if (typeof partial.max === 'number')           param.max = partial.max;
    if (typeof partial.default === 'number')       param.default = partial.default;
    if (typeof partial.decimalPlaces === 'number') param.decimalPlaces = partial.decimalPlaces;
    param._userAuthored = true;
  })),

  /**
   * Add a breakpoint key value to a parameter. Idempotent
   * (epsilon-equal values dedup). Sorts ascending. Tracks the new
   * value in `_userAuthoredKeys` so Init Rig 'merge' preserves it.
   * Does NOT expand existing deformer keyforms — Track 3 owns that.
   */
  addParamKey: (paramId, value) => set(produce((state) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    state.hasUnsavedChanges = true;
    const param = (state.project.parameters ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    const EPS = 1e-6;
    const keys = coerceNumberArray(param.keys, `addParamKey[${paramId}].param.keys`);
    if (!keys.some((k) => Math.abs(k - value) < EPS)) {
      keys.push(value);
      keys.sort((a, b) => a - b);
      param.keys = keys;
    }
    const userKeys = coerceNumberArray(param._userAuthoredKeys, `addParamKey[${paramId}].param._userAuthoredKeys`);
    if (!userKeys.some((k) => Math.abs(k - value) < EPS)) {
      userKeys.push(value);
      userKeys.sort((a, b) => a - b);
      param._userAuthoredKeys = userKeys;
    }
    param._userAuthored = true;
  })),

  /**
   * Remove a breakpoint key value from a parameter. Removes from both
   * `keys` and `_userAuthoredKeys` (if it was user-added). Does NOT
   * collapse existing deformer keyforms — they stay until the next
   * Init Rig pass regenerates the keyform list.
   */
  removeParamKey: (paramId, value) => set(produce((state) => {
    if (typeof value !== 'number') return;
    state.hasUnsavedChanges = true;
    const param = (state.project.parameters ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    const EPS = 1e-6;
    if (Array.isArray(param.keys)) {
      param.keys = param.keys.filter((k) => Math.abs(k - value) >= EPS);
    }
    if (Array.isArray(param._userAuthoredKeys)) {
      param._userAuthoredKeys = param._userAuthoredKeys.filter((k) => Math.abs(k - value) >= EPS);
    }
    param._userAuthored = true;
  })),

  /**
   * Toggle the `_userAuthored` lock flag on a parameter. When set,
   * Init Rig 'merge' mode preserves the parameter verbatim (range,
   * default, keys, role unchanged). 'replace' mode still clobbers.
   */
  setParameterUserAuthored: (paramId, on) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const param = (state.project.parameters ?? []).find((p) => p?.id === paramId);
    if (!param) return;
    if (on) param._userAuthored = true;
    else delete param._userAuthored;
  })),

  // ── Weight paint (V4 Phase 4b) ────────────────────────────────────
  // All actions write through immer so they're undoable. They migrate
  // legacy `mesh.boneWeights` + `mesh.jointBoneId` into the modern
  // `mesh.weightGroups` + `mesh.activeWeightGroup` shape on first
  // touch, then mirror the active group's weights back into
  // `mesh.boneWeights` so the cmo3 export pipeline stays unchanged
  // (single-bone export preserved per plan §6 scope cut).

  /**
   * Ensure a part's mesh has the weightGroups shape. Idempotent.
   * Used as the first step of entering weight paint mode (so the
   * brush has something to paint into) and by `setActiveWeightGroup`
   * before swapping the active.
   */
  ensureWeightGroupsForPart: (partId) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find((n) => n?.id === partId);
    const mesh = getMesh(node, state.project);
    if (!mesh) return;
    const boneGroups = state.project.nodes.filter((n) => n?.type === 'group');
    if (ensureWeightGroups(mesh, boneGroups)) {
      syncBoneWeightsFromActive(mesh, boneGroups);
    }
  })),

  /**
   * Switch the active weight group on a part. Auto-migrates if needed
   * (so the user can pick "set active" before painting). Mirrors the
   * new active group into legacy `mesh.boneWeights`.
   */
  setActiveWeightGroup: (partId, groupName) => set(produce((state) => {
    state.hasUnsavedChanges = true;
    const node = state.project.nodes.find((n) => n?.id === partId);
    const mesh = getMesh(node, state.project);
    if (!mesh) return;
    const boneGroups = state.project.nodes.filter((n) => n?.type === 'group');
    ensureWeightGroups(mesh, boneGroups);
    if (typeof groupName !== 'string' || !mesh.weightGroups?.[groupName]) return;
    mesh.activeWeightGroup = groupName;
    syncBoneWeightsFromActive(mesh, boneGroups);
  })),

  /**
   * Phase 2b storage flip — write the per-object `Object.mode` field on
   * the named node (Blender-compatible per-object mode storage; today's
   * `editorStore.editMode` slot remains the read source-of-truth, but
   * this dual-write means project state carries the mode record so
   * future readers can switch over without a data migration).
   *
   * Pass `null` to clear the field (= Object Mode, the default).
   * Caller is editorStore's `enterEditMode` / `exitEditMode`. No-op when
   * nodeId is missing, or when the node is gone (deleted between
   * selection and call). Snapshots for undo via `projectMutator`-style
   * inline ritual — the immer recipe pushes the snapshot before mutation.
   *
   * Note: this action does NOT bump versionControl counters because the
   * Object.mode field doesn't influence geometry, params, or rig output;
   * it's pure UI state mirrored into the project for persistence.
   *
   * @param {string|null} nodeId
   * @param {*} mode  see modeCompat.js for valid values
   */
  setActiveObjectMode: (nodeId, mode) => {
    if (typeof nodeId !== 'string' || nodeId.length === 0) return;
    set((state) => {
      if (!isBatching()) pushSnapshot(state.project);
      return produce(state, (draft) => {
        const node = draft.project.nodes.find((n) => n?.id === nodeId);
        if (!node) return;
        setObjectMode(node, mode);
        draft.hasUnsavedChanges = true;
      });
    });
  },

  /**
   * Apply a brush stroke's per-vertex updates to the active weight
   * group. Updates is `[{ vertexIndex, weight }]`. Mirrors back to
   * `mesh.boneWeights` automatically. Called many times per stroke;
   * each call is one immer commit (undo restores per-stroke
   * granularity).
   */
  paintWeightStroke: (partId, updates) => {
    if (!Array.isArray(updates) || updates.length === 0) return;
    set(produce((state) => {
      state.hasUnsavedChanges = true;
      const node = state.project.nodes.find((n) => n?.id === partId);
      const mesh = getMesh(node, state.project);
      if (!mesh) return;
      const boneGroups = state.project.nodes.filter((n) => n?.type === 'group');
      ensureWeightGroups(mesh, boneGroups);
      applyWeightStroke(mesh, updates, boneGroups);
      // NOTE: do NOT bump geometryVersion here. Weights are not geometry —
      // bumping it invalidates rigSpec on every paint commit, which makes
      // the live-preview physics tick rebuild physicsState every frame
      // (resetting accumulated pendulum velocity). The mesh vertex array
      // hasn't changed, so the rig is still valid.
    }));
  },

  /**
   * Blender's "Apply Pose As Rest" — bake every bone's pose offset
   * into descendant rest data and zero all bone poses simultaneously.
   *
   * After this, the current visual state IS the new rest pose:
   *   - Mesh `restX/restY` (and `x/y`) are updated to the canvas-space
   *     positions the meshes were previously rendered at (with poses
   *     active). Render at zero pose now matches pre-bake render.
   *   - Each bone's `transform.pivotX/pivotY` shifts to the joint's
   *     visually-current canvas-space position. Future bone arc drags
   *     rotate around the right point.
   *   - All bones' `pose` fields zero out.
   *
   * Driver-param bones (arms / elbows / head — anything with a
   * `ParamRotation_<role>` param) keep their pose at zero by contract,
   * so this action is a no-op for them. Their rotation lives in
   * params and the rig deformer chain; that wiring is untouched.
   *
   * Why all poses must zero simultaneously: rotation around point A by
   * angle α composed with rotation around point B by angle β isn't a
   * rotation by (α+β) around any C derivable from A and B alone. If we
   * baked one bone at a time leaving descendant poses in place, the
   * descendant pose centers shift but their rotations don't compose
   * correctly. Zero-all-at-once + bake cumulative world matrices into
   * mesh rest sidesteps that — meshes carry the cumulative transform
   * directly in canvas-space.
   *
   * Bumps `geometryVersion` so `rigSpecStore` invalidates and rebuilds
   * against the new rest. Idle motions / animation deltas computed
   * relative to mesh rest will see the new baseline; existing keyframe
   * tracks targeting bone poses still fire (they target node id +
   * prop name, neither of which changed).
   */
  /**
   * BVR-004 — Armature Edit Mode parent translate.
   * Shifts a bone's `transform.pivotX/Y` by `(dx, dy)`; **descendants
   * follow** by applying the same delta to their pivots so the rest
   * topology stays rigid. Mirrors Blender's Edit Mode "G" on a parent
   * bone — children move in lockstep.
   *
   * Pure-rest write: only `transform.pivotX/Y` are touched. `node.pose`
   * is untouched. Children's `pose` is untouched too — descendant-
   * follow is rest-frame-only.
   *
   * @param {string} nodeId — id of the bone to translate
   * @param {number} dx — canvas-px delta on X
   * @param {number} dy — canvas-px delta on Y
   */
  shiftBonePivot: (nodeId, dx, dy) => set(produce((state) => {
    const project = state.project;
    const nodes = project.nodes ?? [];
    if (nodes.length === 0) return;
    if (typeof dx !== 'number' || typeof dy !== 'number') return;
    if (dx === 0 && dy === 0) return;
    const start = nodes.find((n) => n?.id === nodeId);
    if (!start || start.type !== 'group' || !start.boneRole) return;
    // Walk descendants once (BFS) so we touch every bone whose chain
    // includes the dragged bone. Non-bone descendants don't carry
    // pivots — skip them, but DO descend through them so a bone child
    // separated by a plain group still moves.
    /** @type {Map<string, string[]>} */
    const childrenById = new Map();
    for (const n of nodes) {
      if (!n?.parent) continue;
      let bucket = childrenById.get(n.parent);
      if (!bucket) { bucket = []; childrenById.set(n.parent, bucket); }
      bucket.push(n.id);
    }
    const queue = [nodeId];
    const visited = new Set();
    while (queue.length > 0) {
      const cur = queue.shift();
      if (visited.has(cur)) continue;
      visited.add(cur);
      const n = nodes.find((nn) => nn?.id === cur);
      if (n && n.type === 'group' && n.boneRole) {
        if (!n.transform) {
          n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
        }
        n.transform.pivotX = (n.transform.pivotX ?? 0) + dx;
        n.transform.pivotY = (n.transform.pivotY ?? 0) + dy;
      }
      const kids = childrenById.get(cur) ?? [];
      for (const kid of kids) queue.push(kid);
    }
    // Pivot is rest-frame; bump geometryVersion so rigSpec invalidates.
    state.versionControl.geometryVersion++;
  })),

  applyPoseAsRest: () => {
    set(produce((state) => {
    const project = state.project;
    const nodes = project.nodes ?? [];
    if (nodes.length === 0) return;

    const worldMap = computeWorldMatrices(nodes);

    // 1. Bake each part's world matrix into its mesh rest verts. The
    //    world matrix already incorporates every ancestor bone's pose,
    //    so this captures the cumulative transform in canvas-space.
    //
    // # The hasArmatureMod gate (2026-05-09)
    //
    // Post-Cubism-Adapter (Phase 2 — overlay path deleted), only
    // parts with an active Armature modifier visually follow bone
    // pose at render time (`CanvasViewport.jsx:817-834` → LBS overlay
    // when `composition.kind === 'lbs'`). Parts without the modifier
    // render at chainEval's canvas-px output verbatim — bone pose
    // doesn't move them. So rebasing their mesh.vertices here would
    // produce a SILENT visual jump on Apply Pose As Rest (rest now
    // points to a position the part never visually was).
    //
    // The gate also fixes the Apply Modifier → Apply Pose As Rest
    // composition: post-Apply parts have already absorbed the pose
    // into mesh.vertices (LBS bake) AND have their modifier removed.
    // Step 1 without the gate would re-rotate them by the still-
    // non-zero parent bone pose, producing a double-rotated rest.
    // Same gate as Step 1b below (which already had this fix for the
    // bone-baked-keyform code path).
    let bakedAnything = false;
    for (const n of nodes) {
      const nMesh = getMesh(n, project);
      if (!isMeshedPart(n, project) || !nMesh || !Array.isArray(nMesh.vertices)) continue;
      const hasArmatureMod = Array.isArray(n.modifiers)
        && n.modifiers.some((mod) => mod?.type === 'armature' && mod.enabled !== false);
      if (!hasArmatureMod) continue;
      const m = worldMap.get(n.id);
      if (!m) continue;
      // Skip if the matrix is identity — nothing to bake on this part.
      const isIdentity =
           Math.abs(m[0] - 1) < 1e-6 && Math.abs(m[1])     < 1e-6
        && Math.abs(m[3])     < 1e-6 && Math.abs(m[4] - 1) < 1e-6
        && Math.abs(m[6])     < 1e-6 && Math.abs(m[7])     < 1e-6;
      if (isIdentity) continue;
      for (const v of nMesh.vertices) {
        if (!v) continue;
        const rx = (typeof v.restX === 'number') ? v.restX : v.x;
        const ry = (typeof v.restY === 'number') ? v.restY : v.y;
        const nx = m[0] * rx + m[3] * ry + m[6];
        const ny = m[1] * rx + m[4] * ry + m[7];
        v.restX = nx;
        v.restY = ny;
        v.x     = nx;
        v.y     = ny;
      }
      bakedAnything = true;
    }

    // 1b. Clear `mesh.runtime` on armature-mod parts whose mesh.vertices
    //     just got rebased.
    //
    // Without baking the runtime cache, chainEval continues to read the
    // OLD pre-rebase keyform vertex positions (snap-back bug class —
    // pre-2026-05-09 BUG-027). Pre-2026-05-09 we did this in place via
    // a linear-only matrix bake (`vp[i] = m0*x + m3*y;`), but that
    // assumed keyforms were stored in joint-bone-pivot-relative frame
    // — they're actually in PARENT-DEFORMER-LOCAL frame
    // (`selectRigSpec.js:580-613`). Linear-only is correct only when
    // the parent deformer's pivot coincides with the joint bone's
    // pivot (limb case). For non-limb rigid-intent parts (handwear,
    // face-region under a non-coincident parent), the formula rotated
    // around the wrong center.
    //
    // The structurally correct fix: drop the cache so `selectRigSpec`'s
    // pre-rig fallback regenerates a single rest keyform from the new
    // mesh.vertices on the next chainEval pass. Same approach as
    // `ArmatureModifierService.applyArmatureModifier` (2026-05-09):
    // no frame-translation guesswork, just rebuild from the fresh
    // canonical source. Per-param bone-baked keyforms (limb
    // skinning's 5-keyform cache) are recovered on the next Init Rig
    // — Apply Pose As Rest is a destructive bake; runtime caches are
    // expected to be regenerated.
    for (const n of nodes) {
      if (n.type !== 'part') continue;
      const meshN = getMesh(n, project);
      if (!meshN || !meshN.runtime) continue;
      const hasArmatureMod = Array.isArray(n.modifiers)
        && n.modifiers.some((m) => m?.type === 'armature' && m.enabled !== false);
      if (!hasArmatureMod) continue;
      delete meshN.runtime;
      bakedAnything = true;
    }

    // 2. Update each bone's pivot to its visually-current canvas
    //    position. We compute this in the bone's PARENT's frame: the
    //    pivot is stored relative to the parent's coordinate system,
    //    but post-bake every parent bone has identity world (pose
    //    zero, rest identity-modulo-pivot which IS identity for any
    //    input point), so parent's frame collapses to canvas.
    //    Therefore the new pivot in parent's frame = the pivot's
    //    canvas position with pre-bake poses.
    for (const n of nodes) {
      if (!isBoneGroup(n)) continue;
      const m = worldMap.get(n.id);
      if (!m) continue;
      // Apply the bone's WORLD matrix to its own pivot. The pivot is
      // an input in the bone's local frame (which is parent's frame
      // under our flat-canvas model); world maps that to canvas.
      const px = n.transform?.pivotX ?? 0;
      const py = n.transform?.pivotY ?? 0;
      const newPx = m[0] * px + m[3] * py + m[6];
      const newPy = m[1] * px + m[4] * py + m[7];
      if (!n.transform) {
        n.transform = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0 };
      }
      n.transform.pivotX = newPx;
      n.transform.pivotY = newPy;
    }

    // 3. Zero all bone poses simultaneously.
    for (const n of nodes) {
      if (!isBoneGroup(n)) continue;
      if (!n.pose) {
        n.pose = { rotation: 0, x: 0, y: 0, scaleX: 1, scaleY: 1 };
      } else {
        n.pose.rotation = 0;
        n.pose.x        = 0;
        n.pose.y        = 0;
        n.pose.scaleX   = 1;
        n.pose.scaleY   = 1;
      }
    }

    if (bakedAnything) {
      state.versionControl.geometryVersion++;
    }
    state.hasUnsavedChanges = true;
    }));
    // Bone-mirror sync: applyPoseAsRest just zeroed every bone's
    // pose.rotation, but `paramValuesStore.values[ParamRotation_<bone>]`
    // is a separate map kept consistent via the bone-mirror intercept.
    // Direct bone mutations (like the produce block above) bypass the
    // intercept, so we re-read the bones into the values map here.
    useParamValuesStore.getState().syncFromProject();
  },

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
      // BFA-006 Phase 6 — legacy sidetables deleted; deformer nodes
      // live in `project.nodes`. resetProject's `state.project.nodes = []`
      // above already clears them. The body warp's layout sidetable:
      state.project.bodyWarpLayout = null;
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
    // BUG-023 instrumentation — surface paramOrphans + deformer/part counts
    // at load time so when the user reports "rig dead after reload" we
    // already have the failure mode logged. Cheap walk, fires once per load.
    {
      const paramIds = new Set((projectData.parameters ?? []).map((p) => p?.id).filter(Boolean));
      const orphans = [];
      let deformerCount = 0;
      let partWithMeshCount = 0;
      for (const n of projectData.nodes ?? []) {
        if (n?.type === 'deformer') {
          deformerCount++;
          for (const b of n.bindings ?? []) {
            if (b?.parameterId && !paramIds.has(b.parameterId)) {
              orphans.push({ nodeId: n.id, parameterId: b.parameterId });
            }
          }
        } else if (n?.type === 'part' && getMesh(n, projectData)?.vertices) {
          partWithMeshCount++;
        }
      }
      logger.info('loadProject', `nodes=${projectData.nodes?.length ?? 0} parts=${partWithMeshCount} deformers=${deformerCount} params=${paramIds.size} initRigDone=${!!projectData.lastInitRigCompletedAt}`, {
        partWithMeshCount,
        deformerCount,
        paramCount: paramIds.size,
        lastInitRigCompletedAt: projectData.lastInitRigCompletedAt ?? null,
      });
      if (orphans.length > 0) {
        logger.warn('paramOrphans', `${orphans.length} binding(s) reference unknown params on load`, { orphans });
      }
      // Hole I-2: binding-vs-param schema drift. Detects bindings whose
      // `keys` no longer match the param's current `keys`, or whose
      // keys fall outside the param's [min, max] range. Drift can sit
      // in a saved project when the user edited a param via V4 Track 2
      // and saved without re-running Init Rig.
      const drift = findBindingSchemaDrift(projectData);
      if (drift.length > 0) {
        logger.warn(
          'paramSchemaDrift',
          `${drift.length} binding(s) drifted from their param schema on load; re-Init Rig to refresh`,
          { drift },
        );
      }
    }
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
      // BFA-006 Phase 6 — `faceParallax` / `bodyWarp` / `rigWarps`
      // sidetables deleted; deformer state lives in `project.nodes`
      // (loaded via `state.project.nodes = projectData.nodes` above).
      // Body warp layout/debug stays as the small dedicated sidetable:
      state.project.bodyWarpLayout = projectData.bodyWarpLayout ?? null;
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
   * Upsert the FaceParallax warp deformer node in `project.nodes`
   * from a pre-computed `WarpDeformerSpec`. Caller produces the spec
   * — typically via `buildFaceParallaxSpec(...)` with current mesh /
   * bbox / pivot inputs. Destructive: overwrites the prior node by
   * id `'FaceParallaxWarp'`.
   *
   * BFA-006 Phase 6 — formerly wrote `project.faceParallax`; the
   * legacy sidetable was deleted by migration v16.
   */
  seedFaceParallax:           projectMutator(seedFaceParallaxFn),

  /**
   * Remove the FaceParallax warp deformer node from `project.nodes`.
   * Use after PSD reimport invalidates stored vertex deltas — the
   * heuristic generator will re-synthesise it on the next Init Rig.
   */
  clearFaceParallax:          projectMutator(clearFaceParallaxFn),

  /**
   * Upsert the body warp chain (BZ → BY → Breath → optional BX) into
   * `project.nodes` as deformer nodes, plus write
   * `project.bodyWarpLayout` (the canvas → innermost-warp normalizer
   * ranges). Caller produces the chain — typically via
   * `buildBodyWarpChain(...)`. Destructive: replaces all four chain
   * nodes (or three if no BX) by id.
   *
   * BFA-006 Phase 6 — formerly wrote the full chain to
   * `project.bodyWarp`; that sidetable was deleted by migration v16.
   * Layout/debug now persist in the small `project.bodyWarpLayout`
   * sidetable since the closures need ranges that can't be recovered
   * from chained `baseGrid`s alone.
   */
  seedBodyWarp:               projectMutator(seedBodyWarpChainFn),

  /**
   * Remove all body-warp-chain deformer nodes from `project.nodes`
   * and null out `project.bodyWarpLayout`. Use after PSD reimport
   * invalidates stored vertex deltas or body silhouette anchors —
   * the heuristic generator will rebuild on the next Init Rig.
   */
  clearBodyWarp:              projectMutator(clearBodyWarpFn),

  /**
   * Upsert per-mesh rigWarp deformer nodes (those with
   * `targetPartId` set) into `project.nodes` from a pre-computed
   * `partId → spec` map (or iterable of specs). Caller is typically
   * a rig-init flow that runs `generateCmo3` once and harvests
   * `rigSpec.warpDeformers` filtered to per-mesh entries.
   * Destructive: replaces every prior rigWarp node whose
   * `targetPartId` is in the incoming map.
   *
   * BFA-006 Phase 6 — formerly wrote `project.rigWarps[partId]`;
   * that sidetable was deleted by migration v16. Each part's
   * `rigParent` field also gets pointed at the deformer's id so the
   * runtime selector (`selectRigSpec`) resolves the per-part chain
   * without walking rigSpec.
   */
  seedRigWarps:               projectMutator(seedRigWarpsFn),

  /**
   * Remove all rigWarp deformer nodes (those with `targetPartId`)
   * from `project.nodes` and clear every part's `rigParent` pointer.
   * Use after PSD reimport invalidates stored per-vertex deltas or
   * any binding-axis change.
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
      // V4 Phase 2 — `seedParametersFn` honours `mode` so user-authored
      // params + user-added keys survive Init Rig 'merge'.
      seedParametersFn(proj, mode);
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
      // BFA-006 Phase 6 fallout — NeckWarp dual-write. Pre-Phase-6
      // the NeckWarp deformer was dropped on the floor (lived only
      // in rigSpec). Post-Phase-6 every per-part rigWarp under it
      // carries `parent: 'NeckWarp'`, so without persisting the
      // NeckWarp itself, export validation fails with ORPHAN_PARENT
      // and the runtime can't resolve the chain. Mirrors the
      // faceParallax dual-write — single deformer, by-id upsert,
      // merge mode preserves a user-authored entry when present.
      if (Array.isArray(proj.nodes)) {
        if (harvest?.neckWarpSpec) {
          if (mode === 'merge') {
            const prior = proj.nodes.find(
              (n) => n && n.id === harvest.neckWarpSpec.id && n.type === 'deformer'
            );
            if (!prior || prior._userAuthored !== true) {
              upsertDeformerNode(proj.nodes, warpSpecToDeformerNode(harvest.neckWarpSpec));
            }
          } else {
            upsertDeformerNode(proj.nodes, warpSpecToDeformerNode(harvest.neckWarpSpec));
          }
        } else if (mode === 'replace') {
          // No NeckWarp this run (faceRig opt-out, or no neck-tagged
          // meshes). Drop any stale entry so children aren't orphaned.
          for (let i = proj.nodes.length - 1; i >= 0; i--) {
            const n = proj.nodes[i];
            if (n?.id === 'NeckWarp' && n.type === 'deformer') {
              proj.nodes.splice(i, 1);
            }
          }
        }
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
      // Drop `ParamRotation_<g>` entries whose owning rotation deformer
      // was pruned as a dead-end orphan in `pruneOrphanRotationDeformers`
      // (initRig.js). seedParameters above synthesises one per non-bone,
      // non-skipped group; harvest knows which of those rotations have
      // no mesh chain through them and reports the corresponding
      // parameter ids back here. Without this, the slider sits in the
      // Parameters panel driving nothing (Rotation_root, Rotation_bothLegs,
      // Rotation_<arm> when handwear has no boneWeights yet, etc.).
      const droppedParamIds = harvest?.droppedParamIds;
      if (Array.isArray(droppedParamIds) && droppedParamIds.length > 0) {
        const dropSet = new Set(droppedParamIds);
        // V4 Phase 2 — keep user-authored params even if their owning
        // rotation deformer was pruned as orphan. Auto-seeded ones drop.
        proj.parameters = proj.parameters.filter((p) => {
          if (!p?.id) return true;
          if (!dropSet.has(p.id)) return true;
          return p._userAuthored === true;
        });
      }
      // Cubism Adapter Phase 1 — fill rigid vertex weights
      // (`mesh.boneWeights = [1.0, …]` + `mesh.jointBoneId =
      // <nearest isBoneGroup ancestor>`) for every meshed part under
      // a bone that doesn't already have weights from
      // `computeSkinWeights` or user paint. Idempotent and lossless
      // — limb skinning + user-painted weights are preserved. The
      // synth below sees the new weights and adds Armature modifiers
      // automatically; the cmo3/moc3 export adapter
      // (`extractMeshExportStruct`) strips rigid-intent weights at
      // serialization to keep wire format byte-identical to pre-v31.
      seedDefaultRigidWeights(proj);
      // Phase 3 storage flip — re-derive each part's modifier stack
      // after the full seed pass. The seedXxx fns each run synthesize
      // individually, but NeckWarp + rotation deformer upserts happen
      // AFTER seedRigWarps so the rigWarps' chain ancestors aren't
      // visible at synthesize time. Re-run once at the end so every
      // part's `Object.modifiers[]` reflects the final tree shape.
      synthesizeModifierStacks(proj);
      // V2 Phase 0.3 — modifier stacks are now canonical; parent-link
      // shape (`deformer.parent` + `part.rigParent`) is a derived mirror
      // for cmo3writer. Run inverse synth after every forward synth so
      // any future caller can mutate stacks alone and trust the mirror
      // to stay consistent. See `synthesizeDeformerParents` doc header.
      synthesizeDeformerParents(proj);
      // Schema v29 — persist `rigSpec.artMeshes` runtime data (bindings
      // + keyforms + parent) into `project.nodes[i].mesh.runtime` so
      // `selectRigSpec(project)` produces an art-mesh tree equivalent
      // to `generateCmo3.result.rigSpec.artMeshes` post save+load and
      // post auto-fill. Without this, bone-baked handwear keyforms +
      // eye-closure curves + neck-corner offsets + variant fades all
      // silently disappear from the live preview.
      if (harvest?.rigSpec) {
        persistArtMeshRuntime(proj, harvest.rigSpec, mode);
      }
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
    // Hole I-2: binding-vs-param schema drift. Detects bindings whose
    // `keys` no longer match the param's current `keys`, or whose keys
    // fall outside the param's [min, max] range. Drift accumulates when
    // the V4 Track 2 param editor mutates a param's range / keys without
    // a follow-up Init Rig — bindings still carry the old schema.
    // Detection only; "you have stale rig wiring" UI banner deferred.
    const drift = findBindingSchemaDrift(postSeedProject);
    if (drift.length > 0) {
      logger.warn(
        'paramSchemaDrift',
        `${drift.length} binding(s) drifted from their param schema; re-Init Rig to refresh`,
        { drift },
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
      const m = getMesh(n, postSeedProject);
      if (!m?.jointBoneId) continue;
      if (!groupIds.has(m.jointBoneId)) {
        boneOrphans.push({ partId: n.id, partName: n.name, jointBoneId: m.jointBoneId });
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
